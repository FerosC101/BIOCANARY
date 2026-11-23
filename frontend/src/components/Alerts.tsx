import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { post } from '../lib/api'
import { dateTime, duration, num } from '../lib/format'
import type { Alert } from '../lib/types'
import { SEVERITY_ZONE } from '../lib/ranges'
import { Dialog, RangeGlyph, StatusIcon } from './ui'

export function AlertList({ alerts }: { alerts: Alert[] }) {
  const [ack, setAck] = useState<Alert | null>(null)
  return (
    <>
      <ul className="alerts">
        {alerts.map((a) => {
          const status = a.ended_at ? 'pending' : a.kind === 'offline' ? 'offline' : a.level
          return (
            <li key={a.id} className={a.ended_at ? 'ended' : 'open'}>
              {a.kind === 'inhibition' ? (
                <span className={`pip pip-range ${a.ended_at ? 'ended' : ''}`}>
                  <RangeGlyph zone={SEVERITY_ZONE[a.severity]} size={22} />
                </span>
              ) : (
                <span className={`pip s-${a.ended_at ? 'ended' : status}`}>
                  <StatusIcon status={a.kind === 'offline' ? 'offline' : a.level} size={14} />
                </span>
              )}
              <div>
                <b>{a.title}</b>
                <small>
                  {dateTime(a.started_at)}
                  {a.ended_at ? `, lasted ${duration((+new Date(a.ended_at) - +new Date(a.started_at)) / 60000)}` : ', ongoing'}
                  {a.peak_inhibition !== null && `, peak ${num(a.peak_inhibition, 0)}%`}
                </small>
                {/* The biological summary is already shown with the station status. */}
                {!a.ended_at && a.kind !== 'inhibition' && <p>{a.message}</p>}
                {a.acknowledged_at ? (
                  <small>
                    Acknowledged by {a.acknowledged_by}
                    {a.acknowledge_note && `: ${a.acknowledge_note}`}
                  </small>
                ) : (
                  !a.ended_at && (
                    <button className="link" onClick={() => setAck(a)}>
                      Acknowledge
                    </button>
                  )
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {ack && <Acknowledge alert={ack} onClose={() => setAck(null)} />}
    </>
  )
}

function Acknowledge({ alert, onClose }: { alert: Alert; onClose: () => void }) {
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const m = useMutation({
    mutationFn: () => post(`/alerts/${alert.id}/acknowledge`, { note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['station'] })
      onClose()
    },
  })
  return (
    <Dialog title="Acknowledge alert" onClose={onClose}>
      <p>
        {alert.title}, started {dateTime(alert.started_at)}. Acknowledging records that you have seen it. The alert stays open until the response returns to normal.
      </p>
      <label>
        Note (optional)
        <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is being done" />
      </label>
      {m.isError && <p className="error">{m.error.message}</p>}
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={m.isPending} onClick={() => m.mutate()}>
          Acknowledge
        </button>
      </div>
    </Dialog>
  )
}
