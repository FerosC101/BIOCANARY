export type Origin = 'simulated' | 'live'
export type Status = 'healthy' | 'warning' | 'critical' | 'offline' | 'pending'
export type Severity = 'normal' | 'mild' | 'moderate' | 'severe' | 'unclassified' | 'inconclusive' | 'insufficient'
export type Quality = 'valid' | 'suspect' | 'invalid' | 'missing'
export type Location = 'reference' | 'exposed' | 'environment'
export type Connection = 'ok' | 'suspect' | 'invalid' | 'missing' | 'offline' | 'never'

export interface User {
  email: string
  name: string
  role: 'operator' | 'admin'
}

export interface Station {
  code: string
  name: string
  description: string
  origin: Origin
  facility: string
  location: string
  timezone: string
  status: Status
  status_label: string
  status_reason: string
  last_reading_at: string | null
  open_alerts: number
  expected_interval_seconds: number
}

export interface SensorState {
  code: string
  name: string
  location: Location
  quantity: string
  unit: string
  connection: Connection
  valid_min: number | null
  valid_max: number | null
  latest: { value: number | null; quality: Quality; reason: string; recorded_at: string } | null
  counts?: Record<Quality, number>
}

export interface DeviceState {
  code: string
  state: string
  firmware: string
  faults: string[]
  last_seen_at: string | null
}

export interface Series {
  bucket_minutes: number
  t: number[]
  channels: Record<string, (number | null)[]>
  activity_unit: string
  thresholds: Record<'mild' | 'moderate' | 'severe', number | null>
  has_data: boolean
}

export interface Factor {
  quantity: string
  label: string
  strength: 'strong' | 'moderate' | 'none'
  baseline: number
  peak: number
  deviation_z: number
  lead_minutes: number | null
  rho: number | null
  lag_minutes: number | null
  effective_n: number | null
}

export interface AssessmentDetail {
  data_until: string
  origin: Origin
  severity: Severity
  method: string
  anomaly: boolean
  onset: string | null
  signals: {
    sufficient: boolean
    reason: string
    valid_fraction: number
    ref_activity: number | null
    exp_activity: number | null
    inhibition: number | null
    baseline_ready: boolean
    baseline_hours: number
    baseline_ratio: number | null
    z_response: number | null
    reference_shift_pct: number | null
    reference_suspect: boolean
  }
  confidence: number | null
  confidence_reason: string
  threshold: { used: boolean; class: Severity | null; reason: string; values: Series['thresholds'] }
  model: {
    used: boolean
    reason: string
    error?: boolean
    backend?: string
    version?: string
    prediction?: { label: Severity; probabilities: Record<string, number>; confidence: number | null; model_version: string; training_origin: string }
  }
  agreement: boolean | null
  factors: Factor[]
  nearby_events: { occurred_at: string; kind: string; note: string }[]
  activity_unit: string
  formula_expression: string
  explanation: {
    headline: string
    summary: string
    abnormality: string
    evidence: { label: string; value: string; note: string }[]
    recommendations: { action: string; reason: string }[]
  }
}

export interface Assessment {
  id: number
  data_until: string
  assessed_at: string
  severity: Severity
  severity_label: string
  risk: string
  anomaly: boolean
  inhibition: number | null
  confidence: number | null
  origin: Origin
  protocol_version: string
  model_version: string
  inference_backend: string
  detail: AssessmentDetail
}

export interface Alert {
  id: number
  kind: 'inhibition' | 'anomaly' | 'reference' | 'sensor' | 'offline'
  level: 'warning' | 'critical'
  severity: string
  title: string
  message: string
  origin: Origin
  started_at: string
  ended_at: string | null
  last_seen_at: string
  peak_inhibition: number | null
  acknowledged_at: string | null
  acknowledged_by: string | null
  acknowledge_note: string
}

export interface Overview {
  station: Station
  sensors: SensorState[]
  devices: DeviceState[]
  assessment: Assessment | null
  alerts: Alert[]
  series: Series
  protocol_status: 'unvalidated' | 'demonstration' | 'validated'
}

export interface Episode {
  id: number
  started_at: string
  ended_at: string | null
  hours: number
  severity: Severity
  peak_inhibition: number | null
  factors: string[]
}

export interface Patterns {
  days: number
  from: string
  to: string
  daily: { date: string; max_inhibition: number | null; severity: Severity; withheld: number; count: number }[]
  episodes: Episode[]
  episode_count: number
  past_count: number
  median_hours: number | null
  by_hour: number[]
  factors: { label: string; count: number }[]
  similar: (Episode & { distance: number })[]
  timezone: string
}

export interface AnalysisView {
  assessment: Assessment | null
  is_latest: boolean
  alert: Alert | null
  patterns: Patterns | null
}

export interface AssessmentRow {
  id: number
  data_until: string
  severity: Severity
  anomaly: boolean
  inhibition: number | null
  confidence: number | null
}

export interface ProtocolConfig {
  activity: { source: string; quantity: string; unit: string; window_minutes: number }
  formula: string
  assessment_window_minutes: number
  min_valid_fraction: number
  min_reference_activity: number | null
  baseline: { days: number; guard_hours: number; min_hours: number }
  anomaly: { z_threshold: number; cusum_k: number; cusum_h: number; min_log_sd: number }
  reference_check: { z_threshold: number; min_shift_percent: number }
  thresholds: Series['thresholds']
}

export interface Protocol {
  id: number
  name: string
  version: string
  validation_status: Overview['protocol_status']
  validation_reference: string
  config: ProtocolConfig
  formulas: Record<string, { label: string; expression: string; note: string }>
  activity_sources: Record<string, string>
}

export interface ModelCard {
  available: boolean
  inference_provider: string
  version: string
  created_at: string
  framework: string
  architecture: string
  training_origin: string
  classes: string[]
  features: string[]
  limitations: string
  dataset: { rows: number; stations: number; split: Record<string, { stations: number; rows: number }> }
  calibration: { method: string; ece_before: number; ece_after: number; calibrated: boolean }
  metrics: { evaluated_on: string; accuracy: number; macro_f1: number; within_one_class: number; confusion: number[][] }
}

export interface Reading {
  id: number
  recorded_at: string
  received_at: string
  sensor: string
  name: string
  location: Location
  unit: string
  value: number | null
  quality: Quality
  reason: string
  origin: Origin
}

export interface ProcessEvent {
  id: number
  occurred_at: string
  kind: 'sampling' | 'discharge' | 'maintenance' | 'other'
  note: string
  origin: Origin
  recorded_by: string
}

export interface ServiceStatus {
  key: string
  name: string
  responsibility: string
  provider: string
  huawei: boolean
  state: 'connected' | 'local' | 'error'
  detail: string
  latency_ms: number | null
}

export interface SystemStatus {
  environment: string
  cloud: { mode: string; label: string; services: ServiceStatus[] }
  data: { simulated_stations: number; live_stations: number; live_data_received: boolean }
}

export interface ReportSummary {
  activity: Record<'reference' | 'exposed', { min: number | null; median: number | null; max: number | null }>
  inhibition: { median: number | null; max: number | null }
  assessments: { total: number; by_severity: { severity: Severity; label: string; count: number }[] }
  events: (Episode & { severity_label: string; title: string; kind: string; acknowledged_by: string | null })[]
  sensors: {
    code: string
    name: string
    unit: string
    location: Location
    min: number | null
    median: number | null
    max: number | null
    coverage: number
    invalid: number
    missing: number
    suspect: number
  }[]
  performance: { expected_intervals: number; reporting: number; paired: number; invalid: number; missing: number; suspect: number; interval_minutes: number }
  protocol: { name: string; version: string; validation_status: string; formula: { expression: string }; activity_unit: string }
  series: Series
  has_data: boolean
}

export interface ReportFile {
  id: number
  created_at: string
  created_by: string
  station: string
  station_name: string
  period_start: string
  period_end: string
  format: 'pdf' | 'csv'
  origin: Origin
  filename: string
  size_bytes: number
  severity_filter: string
  object_provider: string
}
