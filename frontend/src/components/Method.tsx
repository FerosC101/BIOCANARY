import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { get, put } from '../lib/api'
import { useApp } from '../lib/app'
import { day, percent } from '../lib/format'
import type { Assessment, ModelCard, Protocol, ProtocolConfig } from '../lib/types'
import { Dialog, Section } from './ui'

const VALIDATION = { unvalidated: 'Not validated', demonstration: 'Demonstration only', validated: 'Validated' }

export function MethodPanel({ assessment }: { assessment?: Assessment }) {
  const { station, user } = useApp()
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const protocol = useQuery({ queryKey: ['station', station.code, 'protocol'], queryFn: () => get<Protocol>(`/stations/${station.code}/protocol`) })
  const model = useQuery({ queryKey: ['model'], queryFn: () => get<ModelCard>('/model'), refetchInterval: false })
  const p = protocol.data
  const m = model.data
  if (!p) return null
  const f = p.formulas[p.config.formula]
  const t = p.config.thresholds
  return (
    <Section
      title="How this is calculated"
      note={open ? undefined : `${p.name} v${p.version} · anomaly detection against the station's own history${m ? ` · model ${m.version}` : ''}`}
      actions={
        <div className="section-actions">
          <button className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide details' : 'Show details'}
          </button>
          {user.role === 'admin' && open && (
            <button className="btn" onClick={() => setEditing(true)}>
              Edit protocol
            </button>
          )}
        </div>
      }
    >
      {open && <div className="grid-3 method">
        <div>
          <h3>Measurement protocol</h3>
          <dl>
            <dt>Protocol</dt>
            <dd>
              {p.name} v{p.version} ({VALIDATION[p.validation_status].toLowerCase()})
            </dd>
            <dt>Activity</dt>
            <dd>
              {p.activity_sources[p.config.activity.source]} Unit: {p.config.activity.unit}
            </dd>
            <dt>Inhibition indicator</dt>
            <dd>
              <code>{f.expression}</code>
            </dd>
            <dt>Class boundaries</dt>
            <dd>{t.mild === null ? 'None set, so severity is not classified' : `Mild ${t.mild}%, moderate ${t.moderate}%, severe ${t.severe}%`}</dd>
            <dt>Basis</dt>
            <dd>{p.validation_reference || 'Not recorded'}</dd>
          </dl>
        </div>
        <div>
          <h3>Anomaly detection</h3>
          <dl>
            <dt>Baseline</dt>
            <dd>
              This station's previous {p.config.baseline.days} days, excluding the latest {p.config.baseline.guard_hours} h. Needs {p.config.baseline.min_hours} h of data.
            </dd>
            <dt>Sudden change</dt>
            <dd>
              {p.config.assessment_window_minutes}-minute median of the log activity ratio, flagged beyond {p.config.anomaly.z_threshold} robust standard deviations
            </dd>
            <dt>Slow drift</dt>
            <dd>One-sided CUSUM on hourly means over 24 h, limit {p.config.anomaly.cusum_h}</dd>
            <dt>Reference check</dt>
            <dd>Severity is withheld if reference activity itself departs from its baseline</dd>
          </dl>
        </div>
        <div>
          <h3>Trained model</h3>
          {m?.available ? (
            <dl>
              <dt>Model</dt>
              <dd>
                {m.version}, {m.architecture}, trained {day(m.created_at)} with {m.framework}
              </dd>
              <dt>Training data</dt>
              <dd>
                {m.dataset.rows.toLocaleString('en-GB')} {m.training_origin} samples from {m.dataset.stations} {m.training_origin} stations
              </dd>
              <dt>Held-out result</dt>
              <dd>
                {percent(m.metrics.accuracy)} accuracy, macro F1 {m.metrics.macro_f1.toFixed(3)}, calibration error {percent(m.calibration.ece_after)}, on {m.metrics.evaluated_on.replace('held-out ', '')} not used in training
              </dd>
              <dt>Limits</dt>
              <dd>{m.limitations}</dd>
              <dt>Inference</dt>
              <dd>
                {assessment?.inference_backend === 'modelarts' ? 'Huawei ModelArts' : 'In this server process'}
                {assessment && !assessment.detail.model.used && `. Not applied here: ${assessment.detail.model.reason.toLowerCase()}`}
              </dd>
            </dl>
          ) : (
            <p className="sub">No trained model is installed. Assessments use statistics and protocol thresholds only.</p>
          )}
        </div>
      </div>}
      {editing && <EditProtocol p={p} onClose={() => setEditing(false)} />}
    </Section>
  )
}

function EditProtocol({ p, onClose }: { p: Protocol; onClose: () => void }) {
  const qc = useQueryClient()
  const [c, setC] = useState<ProtocolConfig>(p.config)
  const [status, setStatus] = useState(p.validation_status)
  const [reference, setReference] = useState(p.validation_reference)
  const m = useMutation({
    mutationFn: () => put(`/protocols/${p.id}`, { validation_status: status, validation_reference: reference, config: c }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['station'] })
      qc.invalidateQueries({ queryKey: ['stations'] })
      onClose()
    },
  })
  const numeric = (v: string) => (v.trim() === '' ? null : Number(v))
  return (
    <Dialog title={`Edit ${p.name}`} onClose={onClose}>
      <p>Saving creates version {Number(p.version) + 1} and re-assesses the latest reading of every station on this protocol. Earlier assessments keep the version they were made with.</p>
      <label>
        Inhibition formula
        <select value={c.formula} onChange={(e) => setC({ ...c, formula: e.target.value })}>
          {Object.entries(p.formulas).map(([k, f]) => (
            <option key={k} value={k}>
              {f.label}
            </option>
          ))}
        </select>
        <small>{p.formulas[c.formula].expression}. {p.formulas[c.formula].note}</small>
      </label>
      <label>
        Activity source
        <select value={c.activity.source} onChange={(e) => setC({ ...c, activity: { ...c.activity, source: e.target.value, unit: e.target.value === 'direct' ? 'a.u.' : 'mg/L/h' } })}>
          <option value="direct">Reported by the device</option>
          <option value="do_uptake_rate">Dissolved-oxygen decline rate</option>
        </select>
        <small>{p.activity_sources[c.activity.source]}</small>
      </label>
      <div className="fields">
        <label>
          Activity unit
          <input value={c.activity.unit} maxLength={16} onChange={(e) => setC({ ...c, activity: { ...c.activity, unit: e.target.value } })} />
        </label>
        <label>
          Assessment window (min)
          <input type="number" min={10} max={360} step={10} value={c.assessment_window_minutes} onChange={(e) => setC({ ...c, assessment_window_minutes: Number(e.target.value) || 60 })} />
        </label>
        <label>
          Minimum reference activity
          <input type="number" step="any" value={c.min_reference_activity ?? ''} onChange={(e) => setC({ ...c, min_reference_activity: numeric(e.target.value) })} />
        </label>
        {(['mild', 'moderate', 'severe'] as const).map((k) => (
          <label key={k}>
            {k[0].toUpperCase() + k.slice(1)} from (%)
            <input type="number" step="any" value={c.thresholds[k] ?? ''} onChange={(e) => setC({ ...c, thresholds: { ...c.thresholds, [k]: numeric(e.target.value) } })} />
          </label>
        ))}
      </div>
      <label>
        Validation status
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="unvalidated">Not validated: no severity classes on hardware data</option>
          <option value="demonstration">Demonstration: classes on simulated data only</option>
          <option value="validated">Validated: classes on all data</option>
        </select>
      </label>
      <label>
        Validation record
        <textarea rows={2} maxLength={2000} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Experiment or document that supports these boundaries" />
      </label>
      {m.isError && <p className="error">{m.error.message}</p>}
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={m.isPending} onClick={() => m.mutate()}>
          Save new version
        </button>
      </div>
    </Dialog>
  )
}
