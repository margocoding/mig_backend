import { Processor, WorkerHost } from '@nestjs/bullmq';
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { Injectable } from '@nestjs/common';
import { Event, Flow, Media, Member, Speech } from '@prisma/client';
import { Job } from 'bullmq';
import { readFile, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { PrismaService } from 'prisma/prisma.service';
import { MediaService } from 'src/media/media.service';
import { StorageService } from 'src/storage/storage.service';
import * as unzipper from 'unzipper';

type ProcessZipChunk = {
  key: string;
  offset: number;
  size: number;
};

type ProcessZipJob = {
  uploadId: string;
  chunks: ProcessZipChunk[];
  metadataPath: string;
  orderDeadline?: string;
};

@Injectable()
@Processor('zip-processing')
export class EventZipProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<ProcessZipJob>) {
    const { chunks, metadataPath, orderDeadline } = job.data;

    try {
      await this.updateUploadMetadata(metadataPath, {
        status: 'processing',
        updatedAt: new Date().toISOString(),
      });

      await this.processZipStream(
        this.createChunksReadStream(chunks),
        orderDeadline ? new Date(orderDeadline) : undefined,
      );

      await this.updateUploadMetadata(metadataPath, {
        status: 'completed',
        updatedAt: new Date().toISOString(),
      });

      await this.deleteChunks(chunks);
    } catch (error) {
      await this.updateUploadMetadata(metadataPath, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        updatedAt: new Date().toISOString(),
      });

      throw error;
    }
  }

  async processZipStream(streamZip: Readable, orderDeadline?: Date) {
    const parser = streamZip.pipe(unzipper.Parse({ forceStream: true }));

    type Structure = {
      events: Array<
        Event & {
          flows: Array<
            Flow & {
              speeches: Array<
                Speech & {
                  members: Array<
                    Member & {
                      media: Media[];
                    }
                  >;
                }
              >;
            }
          >;
        }
      >;
    };

    const structure: Structure = { events: [] };

    for await (const entry of parser) {
      try {
        if (entry.type !== 'File' || entry.path.startsWith('__MACOSX/')) {
          entry.autodrain();
          continue;
        }

        const filePath = entry.path;

        if (/\/$/.test(filePath)) {
          entry.autodrain();
          continue;
        }

        const parts = filePath.split('/');
        if (parts.length !== 5) {
          console.warn(`Skipping invalid path: ${entry.fileName}`);
          entry.autodrain();
          continue;
        }

        const [eventName, flowName, speechName, memberName, fileName] = parts;

        let event = structure.events.find((e) => e.name === eventName);
        if (!event) {
          event = await this.prisma.event.create({
            data: {
              name: eventName,
              date: new Date(),
              orderDeadline,
            },
            include: {
              flows: {
                include: {
                  speeches: {
                    include: {
                      members: {
                        include: { media: true },
                      },
                    },
                  },
                },
              },
            },
          });
          structure.events.push(event);
        }

        let flow = event.flows.find((f) => f.name === flowName);
        if (!flow) {
          flow = await this.prisma.flow.create({
            data: {
              name: flowName,
              from: new Date(),
              to: new Date(),
              eventId: event.id,
            },
            include: {
              speeches: {
                include: { members: { include: { media: true } } },
              },
            },
          });
          event.flows.push(flow);
        }

        let speech = flow.speeches.find((s) => s.name === speechName);
        if (!speech) {
          speech = await this.prisma.speech.create({
            data: {
              name: speechName,
              flowId: flow.id,
            },
            include: {
              members: {
                include: { media: true },
              },
            },
          });
          flow.speeches.push(speech);
        }

        let member = speech.members.find((m) => m.name === memberName);
        if (!member) {
          member = await this.prisma.member.create({
            data: {
              name: memberName,
              speechId: speech.id,
            },
            include: { media: true },
          });
          speech.members.push(member);
        }

        const order = member.media.length + 1;

        const { filename: mediaFileName, preview } =
          await this.mediaService.uploadFile(member.id, order, {
            stream: entry,
            originalname: fileName,
          });

        const createdMedia = await this.prisma.media.create({
          data: {
            filename: mediaFileName,
            preview,
            order,
            memberId: member.id,
          },
        });

        member.media.push(createdMedia);
      } catch (e) {
        entry.autodrain();
        console.error(e);
      }
    }
  }

  private async updateUploadMetadata(
    metadataPath: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<
      string,
      unknown
    >;

    await writeFile(
      metadataPath,
      JSON.stringify({ ...metadata, ...data }, null, 2),
    );
  }

  private createChunksReadStream(chunks: ProcessZipChunk[]): Readable {
    const storageService = this.storageService;

    return Readable.from(
      (async function* () {
        for (const chunk of chunks) {
          const chunkStream = await storageService.getPrivateObjectStream(
            chunk.key,
          );

          for await (const data of chunkStream) {
            yield data;
          }
        }
      })(),
    );
  }

  private async deleteChunks(chunks: ProcessZipChunk[]): Promise<void> {
    await Promise.all(
      chunks.map((chunk) =>
        this.storageService.deletePrivateObject(chunk.key).catch(() => {}),
      ),
    );
  }
}
