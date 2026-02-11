export const seedData = {
  eventId: '3c6f0dd6-0a6b-4d54-b5ec-4ad8e3ad3b5a',
  stationId: 'b0d5c1a2-5b58-4f4f-8c1b-0f64a4e5c7d2',
  stationCode: 'X',
  judgeId: 'd8c3a88e-7a0b-4d12-8aa7-08cc2464ac67',
  sessionId: '7e8f01f5-7c3b-4f04-9f2b-49e4c0b1d0c3',
  patrols: [
    {
      id: '9a4d1b27-2d4f-4a67-8d1d-540d581aba12',
      team_name: 'Test hlidka',
      category: 'M',
      sex: 'H',
      patrol_code: 'MH-1',
    },
  ],
};

export const bypassClaims = {
  sub: seedData.judgeId,
  sessionId: seedData.sessionId,
  event_id: seedData.eventId,
  station_id: seedData.stationId,
  role: 'authenticated',
  type: 'access',
};

export const bypassPatrols = JSON.stringify(seedData.patrols);
