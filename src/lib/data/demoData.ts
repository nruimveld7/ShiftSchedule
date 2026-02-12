export type Status = 'WORK' | 'OFF' | 'VAC' | 'HLDY' | 'OOT';
export type EventScopeType = 'global' | 'shift' | 'user';
export type EventDisplayMode = 'Schedule Overlay' | 'Badge Indicator' | 'Shift Override';

export type ScheduleEvent = {
  eventId: number;
  scopeType: EventScopeType;
  employeeTypeId: number | null;
  userOid: string | null;
  startDate: string;
  endDate: string;
  eventDisplayMode: EventDisplayMode;
  eventCodeColor: string;
};

export type Employee = {
  name: string;
  role: string;
  pattern: Status[];
  userOid?: string;
  dayColors?: Record<number, string>;
};

export type Group = {
  category: string;
  employeeTypeId?: number;
  employees: Employee[];
};

export const demo: Group[] = [
  {
    category: 'Days Shift',
    employees: [
      { name: 'Alice R', role: 'Operator', pattern: ['WORK', 'WORK', 'OFF', 'OFF'] },
      { name: 'Ben K', role: 'Maintenance', pattern: ['OFF', 'OFF', 'WORK', 'WORK'] },
      { name: 'Cara M', role: 'QA', pattern: ['WORK', 'OFF', 'WORK', 'OFF'] },
      { name: 'Drew S', role: 'Supervisor', pattern: ['WORK', 'WORK', 'WORK', 'OFF'] }
    ]
  },
  {
    category: 'Nights Shift',
    employees: [
      { name: 'Evan T', role: 'Operator', pattern: ['OFF', 'WORK', 'WORK', 'OFF'] },
      { name: 'Fiona P', role: 'Maintenance', pattern: ['WORK', 'OFF', 'OFF', 'WORK'] },
      { name: 'Gus L', role: 'QA', pattern: ['OFF', 'WORK', 'OFF', 'WORK'] }
    ]
  },
  {
    category: 'Crew A',
    employees: [
      { name: 'Hana W', role: 'Operator', pattern: ['WORK', 'WORK', 'OFF', 'OFF'] },
      { name: 'Ivan N', role: 'Operator', pattern: ['WORK', 'OFF', 'OFF', 'WORK'] },
      { name: 'Jules C', role: 'Forklift', pattern: ['OFF', 'WORK', 'WORK', 'OFF'] }
    ]
  }
];

export const overrides: Record<string, { day: number; status: Status }[]> = {
  'Ben K': [
    { day: 6, status: 'VAC' },
    { day: 7, status: 'VAC' },
    { day: 8, status: 'VAC' }
  ],
  'Cara M': [
    { day: 15, status: 'OOT' },
    { day: 16, status: 'OOT' }
  ],
  'Drew S': [{ day: 1, status: 'HLDY' }],
  'Fiona P': [
    { day: 20, status: 'VAC' },
    { day: 21, status: 'VAC' }
  ],
  'Hana W': [{ day: 31, status: 'HLDY' }]
};
