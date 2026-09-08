export type Telemetry = {
  lat: number;
  lng: number;
  altitude: number;
  battery: number | null;
  mode: string;
  source: string;
  timestamp: string | null;
  obstacleNear?: boolean;
  obstacleName?: string;
};

export type Mission = {
  id: string;
  lat: number;
  lng: number;
  altitude: number;
};

export type EmergencyNeed = {
  category: 'TRAUMA' | 'FLOOD' | 'HYPOTHERMIA' | 'LOST';
  title: string;
  urgency: 'CRITICAL' | 'HIGH' | 'URGENT';
  department: string;
  departmentCode: string;
  requiredSupply: string;
  supplyIcon: string;
};

export type Detection = {
  id: string;
  confidence: number;
  frameIndex: number;
  timestamp: string;
  droneLocation: { lat: number; lng: number } | null;
  need: EmergencyNeed;
  signaledDept?: boolean;
  payloadDropped?: boolean;
};

export type Obstacle = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  heightMeters: number;
};

export const DEMO_OBSTACLES: Obstacle[] = [
  { id: 'obs_1', name: 'Transmission Pylon', lat: 12.9738, lng: 77.5975, heightMeters: 45 },
  { id: 'obs_2', name: 'Dense Ridge Canopy', lat: 12.9752, lng: 77.5992, heightMeters: 28 },
  { id: 'obs_3', name: 'Structural Ruins', lat: 12.9725, lng: 77.5960, heightMeters: 35 },
];

export const EMERGENCY_NEEDS_CATALOG: EmergencyNeed[] = [
  {
    category: 'TRAUMA',
    title: 'Immobilized / Trauma Injury',
    urgency: 'CRITICAL',
    department: 'EMS Trauma & Ambulance (108)',
    departmentCode: 'EMS-108',
    requiredSupply: 'Trauma Med-Kit & AED',
    supplyIcon: '🩸'
  },
  {
    category: 'FLOOD',
    title: 'Stranded in Water / Flood Risk',
    urgency: 'HIGH',
    department: 'NDRF Swift Water Rescue Unit',
    departmentCode: 'NDRF-04',
    requiredSupply: 'Inflatable Lifebuoy & Vest',
    supplyIcon: '🛟'
  },
  {
    category: 'HYPOTHERMIA',
    title: 'Hypothermia / Severe Exposure',
    urgency: 'URGENT',
    department: 'Civil Disaster Relief Logistics',
    departmentCode: 'SDRF-RELIEF',
    requiredSupply: 'Thermal Blanket & Food Rations',
    supplyIcon: '❄️'
  },
  {
    category: 'LOST',
    title: 'Isolated / Evac Signal Detected',
    urgency: 'HIGH',
    department: 'Aero Evacuation Squadron',
    departmentCode: 'AIR-EVAC-01',
    requiredSupply: 'Satellite Comm Radio Beacon',
    supplyIcon: '📡'
  }
];
