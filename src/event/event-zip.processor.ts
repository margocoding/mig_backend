import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import fs from 'fs';
import StreamZip from 'node-stream-zip';
import { PrismaService } from 'prisma/prisma.service';
import { MediaService } from 'src/media/media.service';
import yauzl from 'yauzl'

@Processor('zip-processing')
@Injectable()
export class EventZipProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
  ) {
    super();
  }

  private async openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) reject(err);
      else resolve(zip);
    });
  });
}

  async process(job: Job<{ zipPath: string; orderDeadline?: Date }>) {
    const { zipPath, orderDeadline } = job.data;

    const zip = await this.openZip(zipPath);

    type MediaItem = {
      entry: yauzl.Entry;
      filename: string;
    };

    type Structure = {
      events: {
        name: string;
        orderDeadline?: Date;
        flows: {
          name: string;
          speeches: {
            name: string;
            members: {
              name: string;
              media: MediaItem[];
            }[];
          }[];
        }[];
      }[];
    };

    const structure: Structure = { events: [] };

    const readEntries = async (): Promise<void> =>
      new Promise((resolve, reject) => {
        zip.readEntry();

        zip.on('entry', (entry) => {
          if (/\/$/.test(entry.fileName)) {
            zip.readEntry();
            return;
          }

          const parts = entry.fileName.split('/');
          if (parts.length !== 5) {
            console.warn(`⚠️ Skipping invalid path: ${entry.fileName}`);
            zip.readEntry();
            return;
          }

          const [eventName, flowName, speechName, memberName, filename] = parts;

          let event = structure.events.find((e) => e.name === eventName);
          if (!event) {
            event = { name: eventName, flows: [], orderDeadline };
            structure.events.push(event);
          }

          let flow = event.flows.find((f) => f.name === flowName);
          if (!flow) {
            flow = { name: flowName, speeches: [] };
            event.flows.push(flow);
          }

          let speech = flow.speeches.find((s) => s.name === speechName);
          if (!speech) {
            speech = { name: speechName, members: [] };
            flow.speeches.push(speech);
          }

          let member = speech.members.find((m) => m.name === memberName);
          if (!member) {
            member = { name: memberName, media: [] };
            speech.members.push(member);
          }

          member.media.push({ entry, filename });

          zip.readEntry();
        });

        zip.on('end', resolve);
        zip.on('error', reject);
      });

    try {
      await readEntries();

      // ↓↓↓ дальше ТВОЯ логика вообще без изменений ↓↓↓

      for (const event of structure.events) {
        console.log(`🎫 Event: ${event.name}`);

        const createdEvent = await this.prisma.event.create({
          data: {
            name: event.name,
            date: new Date(),
            orderDeadline: event.orderDeadline,
          },
        });

        for (const flow of event.flows) {
          const createdFlow = await this.prisma.flow.create({
            data: {
              name: flow.name,
              from: new Date(),
              to: new Date(),
              eventId: createdEvent.id,
            },
          });

          for (const speech of flow.speeches) {
            const createdSpeech = await this.prisma.speech.create({
              data: {
                name: speech.name,
                flowId: createdFlow.id,
              },
            });

            for (const member of speech.members) {
              const createdMember = await this.prisma.member.create({
                data: { speechId: createdSpeech.id },
              });

              let order = 1;

              for (const media of member.media) {
                console.log(`⬆️ Upload: ${media.filename}`);

                const buffer = await new Promise<Buffer>((resolve, reject) => {
                  zip.openReadStream(media.entry, (err, stream) => {
                    if (err || !stream) return reject(err);
                    const chunks: Buffer[] = [];
                    stream.on('data', (c) => chunks.push(c));
                    stream.on('end', () => resolve(Buffer.concat(chunks)));
                  });
                });

                const { filename, preview } =
                  await this.mediaService.uploadFile(createdMember.id, order, {
                    buffer,
                    originalname: media.filename,
                  });

                await this.prisma.media.create({
                  data: {
                    filename,
                    preview,
                    order,
                    memberId: createdMember.id,
                  },
                });

                order++;
              }
            }
          }
        }
      }
    } finally {
      zip.close();
      await fs.promises.unlink(zipPath).catch(() => {});
      console.log('🧹 ZIP removed');
    }
  }
}
