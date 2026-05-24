# FILES_CHANGED.md

## Phase 2 Rebuild — File Manifest

### Modified Files

#### `public/index.html`
- **Lines 15-253**: Tailwind config + Style block — Complete token replacement
  - `borderRadius` changed from `0.125rem` to `16px`
  - `surface`, `surface-dim`, `background` colors → `#0a0c10`
  - CSS variables added: `--glass-bg`, `--glass-blur`, `--gold`, `--ember`, etc.
  - `.glass-panel` rewritten with blur(16px), 16px radius, hover bloom
  - `.filigree-corner` updated with rounded tips
  - `.embers-bg` upgraded to dual radial-gradient
  - Added: `.crest-glow`, `.particle`, `.particle-ember`, `.particle-gold`
  - Added: `@keyframes ember-float`, `@keyframes gold-drift`, `@keyframes crest-pulse`
  - `.atelier-input` radius 4px → 8px
  - `.btn` radius 4px → 8px, gradient updated to `#D4AF37 → #927117`
  - Added `.messages-fab` class
  - Mobile breakpoint: margin-top fix, hero scaling

- **Lines 263**: Header classes → deeper obsidian glass + gold border
- **Lines 303**: Sidebar classes → deeper obsidian glass + gold border  
- **Lines 339-563**: Overview section — Full rebuild
  - Old 2-column (3+9) grid → new 3×2 Stitch grid
  - Added Hero Emblem zone with crest-glow
  - Added Messages FAB
  - Added Guild Chat module
  - Activity Feed `#activityFeed` ID preserved
- **Lines 996-1012**: Particle layer — 1 dot → 12 animated particles, div properly closed
- **Line 1273**: Mobile bottom nav → glass treatment

### Unchanged Files
- `server.js`
- `public/app.js`
- `.env`
- `serviceAccountKey.json`
- `design-system/*.md` (forensics docs)
- `design-system/DESIGN_TOKENS.json`
