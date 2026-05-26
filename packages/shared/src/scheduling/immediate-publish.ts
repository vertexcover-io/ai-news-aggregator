import type { PublishChannel } from "./job-ids.js";
import { publishDateForWindow } from "./tz.js";

export interface ImmediatePublishSettings {
  readonly scheduleEnabled: boolean;
  readonly scheduleTimezone: string;
  readonly pipelineTime: string;
  readonly emailEnabled: boolean;
  readonly emailTime: string;
  readonly linkedinEnabled: boolean;
  readonly linkedinTime: string;
  readonly twitterPostEnabled: boolean;
  readonly twitterTime: string;
}

export interface ImmediatePublishInput {
  readonly settings: ImmediatePublishSettings;
  readonly completedAt: Date;
  readonly now: Date;
}

interface ChannelSpec {
  readonly channel: PublishChannel;
  readonly enabled: boolean;
  readonly time: string;
}

// Returns the channels that are enabled AND past-due (now > scheduled moment).
// Pure; never throws. A channel whose window computation throws (bad/missing time,
// channelTime === pipelineTime) is omitted. scheduleEnabled=false => [].
export function selectImmediatePublishChannels(
  input: ImmediatePublishInput,
): PublishChannel[] {
  const { settings, completedAt, now } = input;
  if (!settings.scheduleEnabled) return [];

  const specs: ChannelSpec[] = [
    { channel: "email-send", enabled: settings.emailEnabled, time: settings.emailTime },
    { channel: "linkedin-post", enabled: settings.linkedinEnabled, time: settings.linkedinTime },
    { channel: "twitter-post", enabled: settings.twitterPostEnabled, time: settings.twitterTime },
  ];

  const selected: PublishChannel[] = [];
  for (const spec of specs) {
    if (!spec.enabled) continue;
    let scheduledMoment: Date;
    try {
      scheduledMoment = publishDateForWindow({
        timezone: settings.scheduleTimezone,
        pipelineTime: settings.pipelineTime,
        publishTime: spec.time,
        completedAt,
      });
    } catch {
      continue; // bad/missing time or channelTime === pipelineTime -> defer to cron
    }
    if (now.getTime() > scheduledMoment.getTime()) {
      selected.push(spec.channel);
    }
  }
  return selected;
}
