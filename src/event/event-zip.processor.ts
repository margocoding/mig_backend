import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Event, Flow, Media, Member, Speech } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from 'prisma/prisma.service';
import { MediaService } from 'src/media/media.service';
import { StorageService } from '../storage/storage.service';
import * as unzipper from 'unzipper';

@Processor('zip-processing')
@Injectable()
export class EventZipProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<{ filename: string; orderDeadline?: Date }>) {
    const { filename, orderDeadline } = job.data;

    const streamZip = await this.storageService.getStreamFile(
      'archive',
      filename,
    );
    const parser = streamZip.pipe(unzipper.Parse());

    // const zip = await this.openZip(zipPath);

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

    parser.on('entry', async (entry) => {
      try {
        if (entry.type !== 'File' || entry.path.startsWith('__MACOSX/')) {
          entry.autodrain();
          return;
        }

        const filePath = entry.path;

        if (/\/$/.test(filePath)) {
          entry.autodrain();
          return;
        }

        const parts = filePath.split('/');
        if (parts.length !== 5) {
          console.warn(`⚠️ Skipping invalid path: ${entry.fileName}`);
          return;
        }

        const [eventName, flowName, speechName, memberName, filename] = parts;

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

        /* =========================
       FLOW
    ========================== */
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

        /* =========================
       MEMBER
    ========================== */
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

        /* =========================
       FILE (stream → buffer)
    ========================== */

        const chunks: Buffer[] = [];

        for await (const chunk of entry) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }

        const buffer = Buffer.concat(chunks);

        // Защита от слишком больших файлов
        // const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
        // if (entry.uncompressedSize > MAX_FILE_SIZE) {
        //   throw new Error(
        //     `File too large: ${entry.fileName} (${entry.uncompressedSize})`,
        //   );
        // }

        // const buffer: Buffer = await new Promise((resolve, reject) => {
        //   zip.openReadStream(entry, (err, stream) => {
        //     if (err || !stream) return reject(err);
        //
        //     const chunks: Buffer[] = [];
        //
        //     stream.on('data', (chunk) => {
        //       chunks.push(chunk);
        //     });
        //
        //     stream.on('end', () => {
        //       resolve(Buffer.concat(chunks));
        //     });
        //
        //     stream.on('error', reject);
        //   });
        // });

        const order = member.media.length + 1;

        const { filename: mediaFileName, preview } =
          await this.mediaService.uploadFile(member.id, order, {
            buffer,
            originalname: filename,
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
        console.error(e);
        return;
      }
    });
    // try {
    //   await new Promise<void>((resolve, reject) => {
    //     zip.readEntry();
    //
    //     zip.on('entry', (entry) => {
    //       processEntry(entry)
    //         .then(() => zip.readEntry())
    //         .catch(reject);
    //     });
    //
    //     zip.on('end', resolve);
    //     zip.on('error', reject);
    //   });
    // } finally {
    //   zip.close();
    //   await fs.promises.unlink(zipPath).catch(() => {});
    //   console.log('🧹 ZIP removed');
    // }
  }

  // async processFile() {}
  //
  // private async openZip(path: string): Promise<yauzl.ZipFile> {
  //   return new Promise((resolve, reject) => {
  //     yauzl.open(path, { lazyEntries: true }, (err, zip) => {
  //       if (err || !zip) reject(err);
  //       else resolve(zip);
  //     });
  //   });
  // }
}
