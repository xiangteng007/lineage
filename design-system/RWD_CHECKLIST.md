# RWD_CHECKLIST.md

## Responsive Web Design — Validation Checklist

### Desktop (≥1024px)
- [x] 3×2 card grid renders at full width
- [x] Sidebar visible at 80px fixed width
- [x] Top navigation bar with horizontal menu links
- [x] Hero emblem at 320-360px with crest-glow
- [x] Messages FAB visible beside hero emblem
- [x] Guild Chat shows scrollable messages + input
- [x] Particle system visible and animated
- [x] All glass panels with 16px radius and hover bloom

### Tablet (768px–1023px)
- [x] Grid overrides: 2-column layout (span-6 each)
- [x] Sidebar still visible at 80px
- [x] Hero emblem scales to 260px
- [x] Cards stack into 2×3 grid (verified via CSS media query)
- [x] No horizontal overflow

### Mobile (<768px)
- [x] Sidebar hidden (`display: none`)
- [x] Bottom tab bar visible with glass treatment
- [x] Main content fills full width (`margin-left: 0`)
- [x] Header height reduced to 64px
- [x] Hero emblem scales to 140-180px
- [x] Messages FAB hidden
- [x] Cards stack vertically (col-span-12)
- [x] Bottom padding for tab bar clearance (72px)
- [x] Touch targets ≥ 44px on bottom nav buttons

### Cross-Cutting
- [x] Scrollbar custom-styled (gold thumb, dark track)
- [x] Modal z-index (1000) above all content
- [x] Particle z-index (5) behind content, above background
- [x] Selection color: amber-500/30
- [x] Body overflow: hidden + h-screen (no double scrollbar)
