import { setFonts } from './Theme'

// Single switchboard for the app's three type roles — drag a different Font asset onto
// any of these three Inspector fields and every panel's heading/button/body text picks
// it up on the next run, with no other script needing to change. Works by reassigning
// Theme.ts's exported HEADER_FONT/BUTTON_FONT/BODY_FONT (see the comment there) on
// OnAwake, which always finishes — across every object in the scene — before any
// panel's OnStart runs its buildPanel() and reads them.
@component
export class FontManager extends BaseScriptComponent {
  @input
  @hint('Panel titles only (e.g. "Select Site", "Work Session"). Default: Anton.')
  headerFont!: Font

  @input
  @hint('Button and tile labels (e.g. "+ Plain", "Save", "Sticky Notes"). Default: Big Shoulders.')
  buttonFont!: Font

  @input
  @hint('Paragraph-length body/status text (AI summaries, note content). Default: Encode Sans Semi Condensed.')
  bodyFont!: Font

  onAwake(): void {
    setFonts(this.headerFont, this.buttonFont, this.bodyFont)
  }
}
