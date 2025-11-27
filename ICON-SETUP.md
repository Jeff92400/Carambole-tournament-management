# 🎱 Billiard Icon Setup Instructions

## ✅ What's Been Done

All HTML pages have been updated to use a custom billiard icon image:
- ✅ login.html
- ✅ dashboard.html
- ✅ import-players.html
- ✅ import-tournament.html
- ✅ rankings.html
- ✅ player-history.html

## 📝 What You Need to Do

### Save Your Icon Image

1. **Take your billiard ball icon image** (the one you attached in the chat)
2. **Save it as**: `billiard-icon.png`
3. **Place it in**: `/frontend/images/billiard-icon.png`

### Specifications
- **Format**: PNG (recommended) or JPG
- **Size**: 64x64px or 128x128px (square)
- **Background**: Transparent recommended

## 🔄 Fallback Behavior

If the image file is not found, the pages will automatically fall back to the emoji 🎱

## 📍 Full Path

Your icon should be saved at:
```
/Users/jeffrallet/Library/CloudStorage/OneDrive-Personal/Billard/Ranking App/frontend/images/billiard-icon.png
```

---

## 🐛 IMPORTANT: Rankings Page Debugging

The rankings page still shows "Aucun classement disponible" (no rankings available).

### Next Steps to Debug:

1. **Hard refresh** the rankings page (`Cmd + Shift + R`)
2. **Open browser console** (F12 or Right-click → Inspect → Console tab)
3. **Look for these log messages**:
   ```
   === INITIALIZATION START ===
   Initial currentSeason: null
   Initial currentCategoryId: null
   Loading seasons...
   Seasons response status: 200
   Seasons loaded: ["2025-2026"]
   After loadSeasons, currentSeason: 2025-2026
   Loading categories...
   Categories response status: 200
   Categories loaded: 13
   After loadCategories, currentCategoryId: 11
   Checking if we should load rankings...
   currentSeason: 2025-2026 currentCategoryId: 11
   Calling loadRankings()
   Loading rankings with: {categoryId: 11, season: "2025-2026", hasToken: true}
   Response status: 200
   Rankings loaded: 19
   ```

4. **Share a screenshot** of the console output so I can see where it's failing

The dropdowns are working (✅), but rankings aren't loading yet. The console logs will show exactly what's happening.
