// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { describeSchedule, SCHEDULE_PRESET_CRONS, writtenKindCount, type FileWriteFlags } from '../library-summary'

const noWrites: FileWriteFlags = {
  fileWriteEpubEnabled: false,
  fileWriteFb2Enabled: false,
  fileWritePdfEnabled: false,
  fileWriteCbxEnabled: false,
  fileWriteKindleEnabled: false,
  fileWriteAudioEnabled: false,
  fileWriteWriteCover: false,
}

describe('describeSchedule', () => {
  it('names each preset the editor offers', () => {
    expect(SCHEDULE_PRESET_CRONS.map(({ cron }) => describeSchedule(cron)?.preset)).toEqual([
      'hourly',
      'every6Hours',
      'every12Hours',
      'daily',
      'weekly',
    ])
  })

  it('keeps the time of a daily or weekly schedule that is not at midnight', () => {
    expect(describeSchedule('30 2 * * *')).toEqual({ preset: 'daily', hour: 2, minute: 30 })
    expect(describeSchedule('0 6 * * 5')).toEqual({ preset: 'weekly', hour: 6, minute: 0, weekday: 5 })
  })

  it('reads a weekday of 7 as Sunday', () => {
    expect(describeSchedule('0 0 * * 7')).toMatchObject({ preset: 'weekly', weekday: 0 })
  })

  it('leaves anything the presets cannot name to the full description', () => {
    for (const cron of ['15 3 1 * *', '0 */4 * * *', '5 * * * *', '0 0 * * 1-5', '0 25 * * *', 'not a cron', '']) {
      expect(describeSchedule(cron)).toBeNull()
    }
    expect(describeSchedule(null)).toBeNull()
  })
})

describe('writtenKindCount', () => {
  it('counts each file family that is written', () => {
    expect(writtenKindCount(noWrites)).toBe(0)
    expect(writtenKindCount({ ...noWrites, fileWriteEpubEnabled: true, fileWritePdfEnabled: true })).toBe(2)
  })

  it('counts audio only when the cover is written into it too', () => {
    expect(writtenKindCount({ ...noWrites, fileWriteAudioEnabled: true })).toBe(0)
    expect(writtenKindCount({ ...noWrites, fileWriteAudioEnabled: true, fileWriteWriteCover: true })).toBe(1)
  })
})
