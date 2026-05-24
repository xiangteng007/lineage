# BEFORE_AFTER_NOTES.md

## Before → After Comparison

### Card Material
| Property | BEFORE | AFTER |
|---|---|---|
| Background | `rgba(12,19,33,0.6)` | `rgba(15,20,30,0.45)` |
| Blur | `blur(18px)` | `blur(16px)` + `-webkit-backdrop-filter` |
| Border | `1px solid rgba(240,193,44,0.3)` | `1px solid rgba(212,175,55,0.25)` |
| Border Radius | **0.125rem (2px)** | **16px** |
| Shadow | `0 4px 20px rgba(0,0,0,0.5)` | `0 8px 32px rgba(0,0,0,0.6), 0 0 20px rgba(142,0,0,0.08)` |
| Hover Effect | None | Gold bloom (`0 0 30px rgba(212,175,55,0.1)`) |
| Gradient Border | `rgba(240,193,44,0.4)` → transparent | `rgba(212,175,55,0.5)` → `rgba(212,175,55,0.02)` |

### Layout Structure
| Property | BEFORE | AFTER |
|---|---|---|
| Overview Grid | 2 columns (3+9) | **3×2 grid (3+5+4 / 3+4+5)** |
| Hero Emblem | Small 128px crest inside card | **320px centered with crest-glow atmosphere** |
| Guild Chat | ❌ Missing | ✅ Full chat panel with messages + input |
| Messages FAB | ❌ Missing | ✅ Floating beside hero emblem |
| Top Contributors | Inside small sub-card | ✅ Dedicated glass card with gold/silver/bronze trophies |

### Particle System
| Property | BEFORE | AFTER |
|---|---|---|
| Count | **1 static dot** | **12 animated particles** |
| Types | Single amber dot | **8 ember (crimson) + 4 gold-dust** |
| Animation | `animate-pulse` (CSS utility) | `ember-float` + `gold-drift` (custom keyframes) |
| Z-index | `z-[60]` (above modals!) | `z-[5]` (behind content) |
| Container | **Unclosed div** (broke modals) | ✅ Properly closed |

### Background Atmosphere
| Property | BEFORE | AFTER |
|---|---|---|
| Base Color | `#0c1321` (dark blue) | `#0a0c10` (pure obsidian) |
| `.embers-bg` | Single radial gradient | **Dual gradient** (bottom crimson + top gold) |
| Crest Glow | ❌ None | ✅ Pulsing radial-gradient |

### Typography & Buttons
| Property | BEFORE | AFTER |
|---|---|---|
| Button Radius | 4px | 8px |
| Button Gradient | `#f0c12c → #b45309` | `#D4AF37 → #927117` |
| Input Radius | 4px | 8px |
| Label Color | `rgba(240,193,44,0.7)` | `rgba(212,175,55,0.65)` |
| Button Shadow | `rgba(180,83,9,0.3)` | `rgba(146,113,23,0.4)` |
