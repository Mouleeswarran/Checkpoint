import { OpenAI } from 'RemoteServiceGateway.lspkg/HostedExternal/OpenAI'
import { SessionRecorder, SessionEnded } from './SessionRecorder'
import { supabaseSelect, supabaseInsert } from '../Backend/SupabaseClient'

const SYSTEM_PROMPT = `You are Checkpoint, an assistant that turns a field technician's spoken work session into a structured handoff record for the next technician who visits this site.

You will be given the previous session's summary (if any) as prior context, followed by this session's timeline — narration text interleaved with markers like "[Photo 2 captured here]" showing exactly when each reference photo was taken relative to what was being said.

When you write the summary, insert a reference immediately after the part of the summary that corresponds to what was being narrated when that numbered photo was captured — use the [Photo N captured here] markers in the timeline to know where each photo falls in the narration. This is an approximate placement, not an exact citation — place each photo's number once, near the most relevant sentence. Each reference MUST be its own separate parenthetical containing exactly one number, formatted like (1) — if two photos apply to the same point, write them back to back as (1)(2), never combined as (1, 2) or (1,2). Never reference a photo number that has no marker in the timeline, and never invent a photo reference if no photos were captured.

Reply with STRICT JSON only, no markdown, no commentary, in exactly this shape:
{"summary": "2-4 sentence general summary of what was done this session, with (N) markers inline where relevant", "equipment_mentioned": ["short phrase per piece of equipment or product mentioned"], "parts_changed": ["short phrase per part that was replaced or changed"]}

If nothing qualifies for equipment_mentioned or parts_changed, return an empty array for that field. Never invent equipment or parts that weren't mentioned.`

interface SummaryRow {
  version_number: number
  summary_text: string
}

interface CaptureRow {
  kind: 'image' | 'transcript_chunk'
  text_content: string | null
  storage_path: string | null
}

interface ParsedSummary {
  summary: string
  equipment_mentioned: string[]
  parts_changed: string[]
}

@component
export class SessionSummarizer extends BaseScriptComponent {
  @input
  sessionRecorder!: SessionRecorder

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      this.sessionRecorder.onSessionEnded.add((ended) => this.summarize(ended))
    })
  }

  private async summarize(ended: SessionEnded): Promise<void> {
    const { data: captures, error: captureError } = await supabaseSelect<CaptureRow>(
      'session_captures',
      `select=kind,text_content,storage_path&session_id=eq.${ended.sessionId}&order=captured_at.asc`
    )
    if (captureError) {
      print('[SessionSummarizer] Failed to load captures: ' + captureError)
      return
    }

    // Interleave transcript and images in chronological order (captures is already
    // captured_at.asc), numbering photos 1..N in the order they occurred, so the AI can
    // place "(N)" markers near whatever was being narrated when that photo was taken.
    const timelineParts: string[] = []
    let photoNumber = 0
    for (const c of captures ?? []) {
      if (c.kind === 'transcript_chunk' && c.text_content) {
        timelineParts.push(c.text_content)
      } else if (c.kind === 'image') {
        photoNumber++
        timelineParts.push(`[Photo ${photoNumber} captured here]`)
      }
    }
    const timeline = timelineParts.length > 0 ? timelineParts.join(' ') : '(no speech or photos captured)'

    const { data: priorSummaries } = await supabaseSelect<SummaryRow>(
      'summaries',
      `select=version_number,summary_text&site_id=eq.${ended.siteId}&order=version_number.desc&limit=1`
    )
    const prior = priorSummaries && priorSummaries.length > 0 ? priorSummaries[0] : null
    const nextVersion = (prior?.version_number ?? 0) + 1

    const userContent = [
      prior ? `Previous session summary (version ${prior.version_number}): ${prior.summary_text}` : 'No previous session on record for this site.',
      `This session's timeline: ${timeline}`,
      `Total reference photos captured this session: ${photoNumber}`,
    ].join('\n\n')

    try {
      const response = await OpenAI.chatCompletions({
        model: 'gpt-4.1-nano',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.3,
      })
      const raw = response.choices[0].message.content as string
      const parsed = this.parseSummary(raw)

      const { error: insertError } = await supabaseInsert('summaries', {
        site_id: ended.siteId,
        session_id: ended.sessionId,
        version_number: nextVersion,
        summary_text: parsed.summary,
        equipment_mentioned: parsed.equipment_mentioned,
        parts_changed: parsed.parts_changed,
      })
      if (insertError) {
        print('[SessionSummarizer] Failed to store summary: ' + insertError)
        return
      }
      print('[SessionSummarizer] Stored version ' + nextVersion + ' for site ' + ended.siteId)
    } catch (err) {
      print('[SessionSummarizer] Summarization failed: ' + err)
    }
  }

  private parseSummary(raw: string): ParsedSummary {
    try {
      const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '')
      const parsed = JSON.parse(cleaned)
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : raw,
        equipment_mentioned: Array.isArray(parsed.equipment_mentioned) ? parsed.equipment_mentioned : [],
        parts_changed: Array.isArray(parsed.parts_changed) ? parsed.parts_changed : [],
      }
    } catch (err) {
      print('[SessionSummarizer] JSON parse failed, storing raw text: ' + err)
      return { summary: raw, equipment_mentioned: [], parts_changed: [] }
    }
  }
}
