import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import fs from 'fs';
import StreamZip from 'node-stream-zip';
import { PrismaService } from 'prisma/prisma.service';
import { MediaService } from 'src/media/media.service';

@Processor('zip-processing')
@Injectable()
export class EventZipProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
  ) {
    super();
  }

  async process(job: Job<{ zipPath: string; orderDeadline?: Date }>) {
    const { zipPath, orderDeadline } = job.data;

    const zip = new StreamZip.async({ file: zipPath });

    try {
      const entries = await zip.entries();

      type Structure = {
        events: {
          name: string;
          orderDeadline?: Date,
          flows: {
            name: string;
            speeches: {
              name: string;
              members: {
                name: string;
                media: {
                  entryName: string;
                  filename: string;
                }[];
              }[];
            }[];
          }[];
        }[];
      };

      const structure: Structure = { events: [] };

      for (const entryName of Object.keys(entries)) {
        const entry = entries[entryName];
        if (entry.isDirectory) continue;

        const parts = entryName.split('/');
        if (parts.length !== 5) {
          console.warn(`⚠️ Skipping invalid path: ${entryName}`);
          continue;
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

        member.media.push({ entryName, filename });
      }

      for (const event of structure.events) {
        console.log(`🎫 Event: ${event.name}`);

        const createdEvent = await this.prisma.event.create({
          data: { name: event.name, date: new Date(), orderDeadline: event.orderDeadline },
        });

        console.log(createdEvent);

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

                const stream = await zip.entryData(media.entryName);

                const { filename, preview } =
                  await this.mediaService.uploadFile(createdMember.id, order, {
                    buffer: new Buffer(stream.buffer),
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
    } catch (e) {
      console.error('❌ ZIP processing failed', e);
      throw e;
    } finally {
      await zip.close();
      await fs.promises.unlink(zipPath).catch(() => {});
      console.log('🧹 ZIP removed');
    }
  }
}
