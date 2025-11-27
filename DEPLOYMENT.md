# 🚀 Deploy Billard Ranking App to the Cloud

Your app is now ready to deploy! Follow these steps to get it online for free.

## Step 1: Push to GitHub (5 minutes)

### Option A: Using GitHub Desktop (Easiest)
1. Download GitHub Desktop: https://desktop.github.com
2. Open GitHub Desktop
3. Click "Add" → "Add Existing Repository"
4. Browse to: `/Users/jeffrallet/Library/CloudStorage/OneDrive-Personal/Billard/Ranking App`
5. Click "Publish repository"
6. Uncheck "Keep this code private" (or keep it private, both work)
7. Click "Publish repository"

### Option B: Using Terminal
```bash
# 1. Go to https://github.com/new
# 2. Create a new repository named "billard-ranking-app"
# 3. Don't initialize with README (already have one)
# 4. Copy the repository URL (looks like: https://github.com/YOUR-USERNAME/billard-ranking-app.git)

# 5. Run these commands:
cd "/Users/jeffrallet/Library/CloudStorage/OneDrive-Personal/Billard/Ranking App"
git remote add origin YOUR-REPOSITORY-URL-HERE
git push -u origin main
```

---

## Step 2: Deploy to Render.com (5 minutes)

### 2.1 Create Render Account
1. Go to https://render.com
2. Click "Get Started"
3. Sign up with GitHub (easiest - connects automatically)

### 2.2 Deploy Your App
1. Once logged in, click "New +" button (top right)
2. Select "Web Service"
3. Click "Connect" next to your `billard-ranking-app` repository
4. Fill in the form:
   - **Name**: `billard-ranking-app` (or any name you like)
   - **Region**: Choose closest to France (Frankfurt or Paris if available)
   - **Branch**: `main`
   - **Build Command**: `./render-build.sh`
   - **Start Command**: `cd backend && node server.js`
   - **Instance Type**: Select **"Free"**
5. Click "Create Web Service"

### 2.3 Wait for Deployment
- Render will build and deploy your app (takes 3-5 minutes)
- Watch the logs - you'll see it installing dependencies
- When done, you'll see "Your service is live 🎉"

### 2.4 Get Your URL
- Your app will be available at: `https://billard-ranking-app.onrender.com`
- Or whatever name you chose: `https://YOUR-NAME.onrender.com`

---

## Step 3: Access Your App

✅ From anywhere in the world:
- **URL**: `https://your-app-name.onrender.com`
- Works on iPhone, iPad, Mac, any device
- Works on WiFi or cellular data
- No need for Mac to be running!

---

## Important Notes

### Free Tier Limitations:
- ⚠️ **Sleep after 15 minutes of inactivity**
  - First request after sleep takes ~30 seconds to wake up
  - After that, it's fast
- ✅ Unlimited requests while awake
- ✅ 750 hours/month free (plenty for personal use)

### Database:
- SQLite database will reset when app restarts
- For permanent data, consider upgrading or exporting regularly
- Or switch to a cloud database (can help with that later if needed)

### To Keep App Always Awake (Optional):
Use a free service like UptimeRobot (https://uptimerobot.com) to ping your app every 5 minutes. This prevents it from sleeping.

---

## Troubleshooting

### Build Fails?
Check the logs in Render dashboard. Common issues:
- Build script permissions: Already fixed ✅
- Missing dependencies: Already configured ✅

### App Won't Start?
- Check Render logs
- Make sure PORT environment variable is set to 3000 (already in render.yaml ✅)

### Can't Access Database?
- Database starts empty on first deploy
- You'll need to re-import your data through the web interface
- Or I can help you create a database initialization script

---

## What's Been Prepared

✅ `.gitignore` - Excludes database and node_modules
✅ `render.yaml` - Deployment configuration
✅ `render-build.sh` - Build script for Render
✅ Git repository initialized and committed
✅ API URLs changed to relative paths (works anywhere)

**You're ready to deploy!** 🚀

---

## Need Help?

If you run into any issues during deployment, let me know and I'll help you troubleshoot.
