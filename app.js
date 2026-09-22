import express from "express"
import dotenv from "dotenv"
dotenv.config();

import compression from "compression"
import ejs from "ejs"
import path from "path"
import fs from "fs"
import os from "os"
import { fileURLToPath } from "url"
import passport from "passport"
import session from "express-session"
import MongoStore from "connect-mongo"
import mongoose from "mongoose"
import bcrypt from "bcrypt"
import './views/client/auth/google.js';
import multer from "multer"
import cors from "cors"
import fetch from "node-fetch"
import crypto from "crypto"

//models

import userModel from "./models/user.model.js"
import categoryModel from "./models/category.model.js"
import withdrawalModel from "./models/withdrawal.model.js"
import depositModel from "./models/deposit.model.js"
import adminModel from "./models/admin.model.js"
import pointTableModel from "./models/pointtable.model.js"
import pointTableCoverModel from "./models/pointtablecover.model.js"
import tournamentModel from "./models/tournament.model.js"
import referralModel from "./models/referral.model.js"
import { uploadToCloudinary, deleteFromCloudinary } from "./utils/cloudinary.js"

const app = express();

// Enable HTTP compression for all responses (drastically speeds up HTML, JSON, JS, CSS transfer)
app.use(compression());

app.use(cors({
  origin: "https://ubresports.in",
  credentials: true
}));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static assets BEFORE session & passport so static requests don't hit MongoDB!
app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: 0, etag: false }));
app.use(express.static(path.join(__dirname, 'assets'), { maxAge: 0, etag: false }));
app.use('/images', express.static(path.join(__dirname, 'public', 'images'), { maxAge: 0, etag: false }));
app.use('/images', express.static(path.join(__dirname, 'assets', 'images'), { maxAge: 0, etag: false }));

app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));
app.use(express.urlencoded({ extended: true }));

// database connection with connection pool optimization
mongoose.connect(process.env.MONGO_URI, {
    maxPoolSize: 50,
    minPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000
}).then(() => console.log("database connected successfully..")).catch(err => console.log(err));

app.set('trust proxy', 1);
app.use(session({
    secret: process.env.SESSION_SECRET || "ubr-secret",
    resave: false,
    saveUninitialized: false, // Prevents creating junk sessions in MongoDB for guests/bots
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI,
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60, // 14 days
        touchAfter: 24 * 3600 // Only update session in DB once in 24 hours if data has not changed
    }),
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? 'none' : 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 365 // 1 year
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// Capture ?ref=CODE from query parameter and store in session & cookie
app.use((req, res, next) => {
    if (req.query && req.query.ref) {
        const refCode = req.query.ref.toString().trim().toUpperCase();
        if (refCode) {
            if (req.session) {
                req.session.referralCode = refCode;
            }
            res.cookie('ubr_ref', refCode, { 
                maxAge: 30 * 24 * 60 * 60 * 1000, 
                httpOnly: false,
                sameSite: 'lax'
            });
        }
    }
    next();
});

// Ensure upload temp directory exists safely across Linux VPS, Render, Railway, Docker, Vercel
const uploadTempDir = path.join(os.tmpdir(), 'ubr_uploads');
try {
    if (!fs.existsSync(uploadTempDir)) {
        fs.mkdirSync(uploadTempDir, { recursive: true });
    }
} catch (e) {}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        try {
            if (fs.existsSync(uploadTempDir)) {
                return cb(null, uploadTempDir);
            }
        } catch(e) {}
        cb(null, os.tmpdir());
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

app.set('view engine', 'ejs');
app.set('views', [
    path.join(__dirname, 'views', 'client'),
    path.join(__dirname, 'views', 'admin'),
    path.join(__dirname, 'views')
]);

app.locals.imageUrl = function(img) {
    if (!img) return '/images/photo.jpg.jpeg';
    if (img.startsWith('http://') || img.startsWith('https://')) {
        return img;
    }
    return `/images/${img}`;
};

//middleware

function authCheck(req, res, next){
    if(req.isAuthenticated()){
        return next();
    }

    res.redirect("/signin")
}

function adminAuthCheck(req, res, next){
    if(!req.session.userId){
        return res.redirect("/admin/login");
    }

    next();
}

function isBookedSquadForUserTeam(bookedTeam, userTeam, userId) {
    if (!bookedTeam || !userTeam) return false;

    const userTeamId = userTeam._id ? userTeam._id.toString() : "";
    const bookedTeamId = bookedTeam.teamId ? bookedTeam.teamId.toString() : "";
    const bookedSubdocumentId = bookedTeam._id ? bookedTeam._id.toString() : "";
    const bookedUserId = bookedTeam.userId ? bookedTeam.userId.toString() : "";
    const currentUserId = userId ? userId.toString() : "";
    const userTeamName = userTeam.teamName ? userTeam.teamName.trim().toLowerCase() : "";
    const bookedTeamName = bookedTeam.teamName ? bookedTeam.teamName.trim().toLowerCase() : "";

    if (userTeamId && bookedTeamId) return bookedTeamId === userTeamId;
    if (userTeamId && bookedSubdocumentId) return bookedSubdocumentId === userTeamId;
    if (currentUserId && bookedUserId) {
        return bookedUserId === currentUserId && userTeamName && bookedTeamName === userTeamName;
    }
    return userTeamName && bookedTeamName === userTeamName;
}

const baseurl = process.env.BASE_URL;

// ==========================================
// REFERRAL SYSTEM HELPERS & LOGIC
// ==========================================
async function generateUniqueReferralCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let isUnique = false;
    let code = "";
    while (!isUnique) {
        code = "UBR";
        for (let i = 0; i < 5; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        const existing = await userModel.findOne({ referralCode: code });
        if (!existing) {
            isUnique = true;
        }
    }
    return code;
}

async function linkReferral(refereeUser, referralCode) {
    try {
        if (!referralCode || !refereeUser) return { success: false, msg: "Invalid referral details." };
        const code = referralCode.toString().trim().toUpperCase();

        if (refereeUser.referralCode && refereeUser.referralCode === code) {
            return { success: false, msg: "You cannot use your own referral code." };
        }

        if (refereeUser.referredBy) {
            return { success: false, msg: "A referral code is already linked to this account." };
        }

        const referrer = await userModel.findOne({ referralCode: code });
        if (!referrer) {
            return { success: false, msg: "Referral code not found. Please check and try again." };
        }

        if (referrer._id.toString() === refereeUser._id.toString()) {
            return { success: false, msg: "You cannot use your own referral code." };
        }

        const existingRef = await referralModel.findOne({ referee: refereeUser._id });
        if (existingRef) {
            return { success: false, msg: "Referral already recorded for this user." };
        }

        await referralModel.create({
            referrer: referrer._id,
            referee: refereeUser._id,
            referralCode: code,
            status: "pending",
            rewardAmount: 10
        });

        refereeUser.referredBy = referrer._id;
        await refereeUser.save();

        return { 
            success: true, 
            msg: `Referral applied! ₹10 will be awarded to ${referrer.name || 'your friend'} when you join your first match or tournament.` 
        };
    } catch (err) {
        console.error("[Referral] Error in linkReferral:", err);
        return { success: false, msg: "Failed to link referral code." };
    }
}

async function checkAndRewardReferral(refereeUserId, matchId, matchType) {
    try {
        if (!refereeUserId) return;

        // Atomically find a pending referral and update to completed
        const referral = await referralModel.findOneAndUpdate(
            { referee: refereeUserId, status: "pending" },
            { 
                status: "completed", 
                rewardedAt: new Date(),
                firstMatchId: matchId ? matchId.toString() : "",
                firstMatchType: matchType || "scrim"
            },
            { returnDocument: 'after' }
        );

        if (!referral) {
            // Either user was not referred, or already received reward on a prior match
            return;
        }

        const rewardAmount = referral.rewardAmount || 10;

        // Atomically credit ₹10 to referrer's availableBalance
        await userModel.findByIdAndUpdate(
            referral.referrer,
            { 
                $inc: { "wallet.balance.availableBalance": rewardAmount } 
            }
        );

        // Mark referee as rewarded
        await userModel.findByIdAndUpdate(refereeUserId, {
            isReferralRewarded: true
        });

        console.log(`[Referral Reward] Successfully credited ₹${rewardAmount} to referrer ${referral.referrer} because referee ${refereeUserId} booked 1st ${matchType} (${matchId}).`);
    } catch (err) {
        console.error("[Referral Reward] Error in checkAndRewardReferral:", err);
    }
}

// Redirect and capture route for /ref/:code
app.get("/ref/:code", (req, res) => {
    const code = req.params.code ? req.params.code.toString().trim().toUpperCase() : "";
    if (code) {
        if (req.session) {
            req.session.referralCode = code;
        }
        res.cookie('ubr_ref', code, { 
            maxAge: 30 * 24 * 60 * 60 * 1000, 
            httpOnly: false,
            sameSite: 'lax'
        });
    }
    if (req.isAuthenticated && req.isAuthenticated()) {
        return res.redirect("/dashboard");
    }
    return res.redirect("/signin");
});

// Manual referral code apply endpoint
app.post("/api/referral/apply", authCheck, async (req, res) => {
    try {
        const { code } = req.body;
        if (!code || !code.trim()) {
            return res.status(400).json({ success: false, msg: "Please enter a valid referral code." });
        }

        const user = await userModel.findOne({ gglId: req.user.id });
        if (!user) {
            return res.status(404).json({ success: false, msg: "User not found." });
        }

        if (user.referredBy) {
            return res.status(400).json({ success: false, msg: "You have already linked a referral code." });
        }

        if (user.isReferralRewarded) {
            return res.status(400).json({ success: false, msg: "Referral code can only be applied before playing your first match." });
        }

        const result = await linkReferral(user, code);
        if (!result.success) {
            return res.status(400).json(result);
        }

        return res.status(200).json(result);
    } catch (err) {
        console.error("Error in /api/referral/apply:", err);
        return res.status(500).json({ success: false, msg: "Internal server error applying referral code." });
    }
});

/* Client Routes */

app.get("/checksignin", async (req, res)=>{
    if (req.isAuthenticated()) {
        const user = await userModel.findOne({ gglId: req.user.id });
        if (!user) {
            return res.status(401).json({ authenticated: false });
        }

        // Auto-migrate legacy user.team to user.teams if teams is empty
        if (user.team && user.team.teamName && (!user.teams || user.teams.length === 0)) {
            user.teams = [{
                _id: user.team._id || new mongoose.Types.ObjectId(),
                teamName: user.team.teamName,
                teamLogo: user.team.teamLogo || "",
                whatsappNumber: user.team.whatsappNumber || null,
                totalPoints: user.team.totalPoints || 0,
                totalFinishes: user.team.totalFinishes || 0,
                placementPoints: user.team.placementPoints || 0,
                matchesPlayed: user.team.matchesPlayed || 0,
                chickenDinners: user.team.chickenDinners || 0
            }];
            await user.save().catch(e => console.error("Migration error in checksignin:", e));
        }

        const userTeams = (user.teams && Array.isArray(user.teams) && user.teams.length > 0)
            ? user.teams
            : ((user.team && user.team.teamName) ? [user.team] : []);

        const hasTeam = userTeams.length > 0 && userTeams.some(t => t.teamName);
        const hasDrop = !!(user && user.dropDetails && (user.dropDetails.erangle || user.dropDetails.miramar || user.dropDetails.rando));
        
        let matchTeams = [];
        const { categoryId, matchTitle, matchId, tournamentId, id, title } = req.query;
        const catId = categoryId || id;
        const mTitle = matchTitle || title;
        const mId = matchId;

        if (catId && (mTitle || mId)) {
            try {
                const category = await categoryModel.findOne({ _id: catId });
                if (category && category.matches) {
                    const match = category.matches.find(m => (mId && m._id.toString() === mId.toString()) || (mTitle && m.title === mTitle));
                    if (match && match.teams) {
                        matchTeams = match.teams;
                    }
                }
            } catch(err) {
                console.error("Error checking pre-registration:", err);
            }
        } else if (tournamentId) {
            try {
                const tournament = await tournamentModel.findById(tournamentId);
                if (tournament && tournament.teams) {
                    matchTeams = tournament.teams;
                }
            } catch(err) {
                console.error("Error checking tournament pre-registration:", err);
            }
        }

        const registeredTeamNames = [];
        const registeredTeamIds = [];

        if (matchTeams.length > 0 && userTeams.length > 0) {
            for (const ut of userTeams) {
                const isReg = matchTeams.some(t => isBookedSquadForUserTeam(t, ut, user._id));
                if (isReg) {
                    if (ut.teamName) registeredTeamNames.push(ut.teamName);
                    if (ut._id) registeredTeamIds.push(ut._id.toString());
                }
            }
        }

        // Teams available to book for this match (excluding already registered ones)
        const availableTeams = userTeams.filter(ut =>
            ut.teamName && !matchTeams.some(t => isBookedSquadForUserTeam(t, ut, user._id))
        );

        const isAlreadyRegistered = registeredTeamNames.length > 0;
        const allRegistered = hasTeam && availableTeams.length === 0;

        const availableBalance = (user && user.wallet && user.wallet.balance && typeof user.wallet.balance.availableBalance !== 'undefined') ? Number(user.wallet.balance.availableBalance) : 0;
        const prizePool = (user && user.wallet && user.wallet.balance && typeof user.wallet.balance.prizePool !== 'undefined') ? Number(user.wallet.balance.prizePool) : 0;
        const totalBalance = availableBalance + prizePool;

        return res.status(200).json({ 
            authenticated: true, 
            hasTeam, 
            hasDrop,
            isAlreadyRegistered,
            allRegistered,
            canBookMore: availableTeams.length > 0,
            userTeams,
            availableTeams,
            registeredTeamNames,
            registeredTeamIds,
            totalBalance,
            wallet: {
                availableBalance,
                prizePool,
                totalBalance
            }
        });
    }
    return res.status(401).json({ authenticated: false });
});
app.get("/", async (req, res)=>{
    try {
        const categories = await categoryModel.find().select("-matches").sort({ order: 1, _id: 1 });
        const tournaments = await tournamentModel.find().sort({ createdAt: -1 });
        const coverDoc = await pointTableCoverModel.findOne();
        const pointTableCover = coverDoc ? coverDoc.image : null;

        let userTeamName = null;
        let userTeamNames = [];
        let userTeams = [];
        let wallet = null;

        if (req.isAuthenticated()) {
            const details = await userModel.findOne({ gglId: req.user.id });
            if (details) {
                if (details.teams && Array.isArray(details.teams) && details.teams.length > 0) {
                    userTeams = details.teams;
                    userTeamNames = details.teams.map(t => t.teamName).filter(Boolean);
                    userTeamName = userTeamNames[0] || null;
                } else if (details.team && details.team.teamName) {
                    userTeamName = details.team.teamName;
                    userTeamNames = [details.team.teamName];
                    userTeams = [details.team];
                }
                wallet = details.wallet;
            }
        }

        res.render("index", { categories, tournaments, pointTableCover, userTeamName, userTeamNames, userTeams, wallet, baseurl });
    } catch (err) {
        console.error("Error in home route:", err);
        res.status(500).send("Internal Server Error");
    }
})

app.get("/scrims", (req, res) => {
    res.redirect("/category/6a8a8ab55a9578bb26150e5e");
});

app.get("/results", (req, res) => {
    res.redirect("/leaderboard");
});

// BGMI Revised Point System Calculator (Official rules from image)
// #1=10, #2=6, #3=5, #4=4, #5=3, #6=2, #7=1, #8=1, #9+=0, 1 finish = 1 pt
function calculatePlacementPoints(rank) {
    const r = Number(rank);
    if (r === 1) return 10;
    if (r === 2) return 6;
    if (r === 3) return 5;
    if (r === 4) return 4;
    if (r === 5) return 3;
    if (r === 6) return 2;
    if (r === 7 || r === 8) return 1;
    return 0; // Rank 9 to 16+ get 0 placement points
}

// Sync overall performance statistics (Points, Finishes, Placement Pts, Matches, Chicken Dinners) to userModel
async function syncTeamStats(teamName) {
    if (!teamName || typeof teamName !== 'string') return;
    const targetName = teamName.trim().toLowerCase();
    if (!targetName) return;

    try {
        const categories = await categoryModel.find({ "matches.teams.teamName": { $regex: new RegExp("^" + teamName.trim() + "$", "i") } }).select("matches");
        const tournaments = await tournamentModel.find({ "teams.teamName": { $regex: new RegExp("^" + teamName.trim() + "$", "i") } }).select("teams");

        let totalFinishes = 0;
        let placementPoints = 0;
        let totalPoints = 0;
        let matchesPlayed = 0;
        let chickenDinners = 0;

        function processTeam(t) {
            if (!t || !t.teamName || t.teamName.trim().toLowerCase() !== targetName) return;
            if (t.matchScores && Array.isArray(t.matchScores) && t.matchScores.length > 0) {
                matchesPlayed += t.matchScores.length;
                t.matchScores.forEach(ms => {
                    if (ms.rank) {
                        if (Number(ms.rank) === 1) chickenDinners++;
                        const pPoints = typeof ms.placementPoints !== 'undefined' && ms.placementPoints !== null ? Number(ms.placementPoints) : calculatePlacementPoints(ms.rank);
                        const fPoints = typeof ms.finishPoints !== 'undefined' && ms.finishPoints !== null ? Number(ms.finishPoints) : (Number(ms.finishes) || 0);
                        placementPoints += pPoints;
                        totalFinishes += Number(ms.finishes) || 0;
                        totalPoints += (typeof ms.totalPoints !== 'undefined' && ms.totalPoints !== null) ? Number(ms.totalPoints) : (pPoints + fPoints);
                    }
                });
            } else if (t.rank) {
                matchesPlayed++;
                if (Number(t.rank) === 1) chickenDinners++;
                const pPoints = typeof t.placementPoints !== 'undefined' && t.placementPoints !== null ? Number(t.placementPoints) : calculatePlacementPoints(t.rank);
                const fPoints = typeof t.finishPoints !== 'undefined' && t.finishPoints !== null ? Number(t.finishPoints) : (Number(t.finishes) || 0);
                placementPoints += pPoints;
                totalFinishes += Number(t.finishes) || 0;
                totalPoints += (typeof t.totalPoints !== 'undefined' && t.totalPoints !== null) ? Number(t.totalPoints) : (pPoints + fPoints);
            } else {
                matchesPlayed++;
            }
        }

        categories.forEach(cat => {
            (cat.matches || []).forEach(m => {
                (m.teams || []).forEach(t => processTeam(t));
            });
        });

        tournaments.forEach(tourn => {
            (tourn.teams || []).forEach(t => processTeam(t));
        });

        // Update legacy user.team
        await userModel.updateMany(
            { "team.teamName": { $regex: new RegExp("^" + teamName.trim() + "$", "i") } },
            {
                $set: {
                    "team.totalPoints": totalPoints,
                    "team.totalFinishes": totalFinishes,
                    "team.placementPoints": placementPoints,
                    "team.matchesPlayed": matchesPlayed,
                    "team.chickenDinners": chickenDinners
                }
            }
        );

        // Also update multi-squad user.teams array
        await userModel.updateMany(
            { "teams.teamName": { $regex: new RegExp("^" + teamName.trim() + "$", "i") } },
            {
                $set: {
                    "teams.$[elem].totalPoints": totalPoints,
                    "teams.$[elem].totalFinishes": totalFinishes,
                    "teams.$[elem].placementPoints": placementPoints,
                    "teams.$[elem].matchesPlayed": matchesPlayed,
                    "teams.$[elem].chickenDinners": chickenDinners
                }
            },
            {
                arrayFilters: [{ "elem.teamName": { $regex: new RegExp("^" + teamName.trim() + "$", "i") } }]
            }
        );
    } catch (err) {
        console.error("Error syncing team stats for:", teamName, err);
    }
}

app.get("/leaderboard", async (req, res) => {
    try {
        const usersWithTeams = await userModel.find({ "team.teamName": { $exists: true, $ne: "" } }).select("team wallet");
        const categories = await categoryModel.find().select("matches");
        const tournaments = await tournamentModel.find().select("teams");

        const statsMap = {};
        let totalMatchesCount = 0;

        function recordTeamStats(t) {
            if (!t || !t.teamName) return;
            const name = t.teamName.trim().toLowerCase();
            if (!name) return;

            if (!statsMap[name]) {
                statsMap[name] = {
                    teamName: t.teamName.trim(),
                    teamLogo: t.teamLogo || "",
                    matchesPlayed: 0,
                    totalFinishes: 0,
                    placementPoints: 0,
                    totalPoints: 0,
                    chickenDinners: 0
                };
            }

            const s = statsMap[name];
            if (t.teamLogo && !s.teamLogo) s.teamLogo = t.teamLogo;

            if (t.matchScores && Array.isArray(t.matchScores) && t.matchScores.length > 0) {
                s.matchesPlayed += t.matchScores.length;
                t.matchScores.forEach(ms => {
                    if (ms.rank) {
                        if (Number(ms.rank) === 1) s.chickenDinners += 1;
                        const pPoints = typeof ms.placementPoints !== 'undefined' && ms.placementPoints !== null ? Number(ms.placementPoints) : calculatePlacementPoints(ms.rank);
                        const fPoints = typeof ms.finishPoints !== 'undefined' && ms.finishPoints !== null ? Number(ms.finishPoints) : (Number(ms.finishes) || 0);
                        const tot = typeof ms.totalPoints !== 'undefined' && ms.totalPoints !== null ? Number(ms.totalPoints) : (pPoints + fPoints);

                        s.placementPoints += pPoints;
                        s.totalFinishes += Number(ms.finishes) || 0;
                        s.totalPoints += tot;
                    }
                });
            } else if (t.rank) {
                s.matchesPlayed += 1;
                if (Number(t.rank) === 1) s.chickenDinners += 1;
                const pPoints = typeof t.placementPoints !== 'undefined' && t.placementPoints !== null ? Number(t.placementPoints) : calculatePlacementPoints(t.rank);
                const fPoints = typeof t.finishPoints !== 'undefined' && t.finishPoints !== null ? Number(t.finishPoints) : (Number(t.finishes) || 0);
                const tot = typeof t.totalPoints !== 'undefined' && t.totalPoints !== null ? Number(t.totalPoints) : (pPoints + fPoints);

                s.placementPoints += pPoints;
                s.totalFinishes += Number(t.finishes) || 0;
                s.totalPoints += tot;
            } else {
                s.matchesPlayed += 1;
            }
        }

        categories.forEach(cat => {
            if (cat.matches && Array.isArray(cat.matches)) {
                totalMatchesCount += cat.matches.length;
                cat.matches.forEach(m => {
                    if (m.teams && Array.isArray(m.teams)) {
                        m.teams.forEach(t => recordTeamStats(t));
                    }
                });
            }
        });

        tournaments.forEach(tourn => {
            totalMatchesCount += 1;
            if (tourn.teams && Array.isArray(tourn.teams)) {
                tourn.teams.forEach(t => recordTeamStats(t));
            }
        });

        const teamList = usersWithTeams.map(u => {
            const teamName = (u.team && u.team.teamName) ? u.team.teamName.trim() : "";
            const teamLogo = (u.team && u.team.teamLogo) ? u.team.teamLogo : "";
            const prizePoolWon = (u.wallet && u.wallet.balance && typeof u.wallet.balance.prizePool !== 'undefined') ? Number(u.wallet.balance.prizePool) : 0;
            const lower = teamName.toLowerCase();
            const stats = statsMap[lower] || {
                matchesPlayed: u.team.matchesPlayed || 0,
                totalFinishes: u.team.totalFinishes || 0,
                placementPoints: u.team.placementPoints || 0,
                totalPoints: u.team.totalPoints || 0,
                chickenDinners: u.team.chickenDinners || 0
            };

            return {
                teamName,
                teamLogo: teamLogo || stats.teamLogo || "",
                prizePoolWon,
                matchesPlayed: stats.matchesPlayed || 0,
                totalFinishes: stats.totalFinishes || 0,
                placementPoints: stats.placementPoints || 0,
                totalPoints: stats.totalPoints || 0,
                chickenDinners: stats.chickenDinners || 0
            };
        }).filter(t => t.teamName);

        const registeredNames = new Set(teamList.map(t => t.teamName.toLowerCase()));

        // Include any unregistered tournament/scrim teams from statsMap
        Object.keys(statsMap).forEach(lower => {
            if (!registeredNames.has(lower)) {
                const s = statsMap[lower];
                teamList.push({
                    teamName: s.teamName,
                    teamLogo: s.teamLogo || "",
                    prizePoolWon: 0,
                    matchesPlayed: s.matchesPlayed,
                    totalFinishes: s.totalFinishes,
                    placementPoints: s.placementPoints,
                    totalPoints: s.totalPoints,
                    chickenDinners: s.chickenDinners
                });
            }
        });

        // Official esports sorting: Total Points desc, Total Finishes desc, Prize Pool desc, Matches desc
        teamList.sort((a, b) => {
            if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
            if (b.totalFinishes !== a.totalFinishes) return b.totalFinishes - a.totalFinishes;
            if (b.prizePoolWon !== a.prizePoolWon) return b.prizePoolWon - a.prizePoolWon;
            return b.matchesPlayed - a.matchesPlayed;
        });

        const rankedTeams = teamList.map((t, idx) => ({ ...t, rank: idx + 1 }));
        const totalPrizeDistributed = rankedTeams.reduce((acc, curr) => acc + (curr.prizePoolWon || 0), 0);
        const pointTables = await pointTableModel.find().sort({ _id: -1 });

        let userTeamName = null;
        let wallet = null;
        if (req.isAuthenticated()) {
            const details = await userModel.findOne({ gglId: req.user.id });
            if (details) {
                wallet = details.wallet;
                if (details.team && details.team.teamName) {
                    userTeamName = details.team.teamName;
                }
            }
        }

        res.render("client/pages/leaderboard", {
            rankedTeams,
            categories: (categories || []).map(c => ({ _id: c._id, title: c.title })),
            totalMatchesCount,
            totalPrizeDistributed,
            pointTables,
            userTeamName,
            wallet,
            baseurl
        });
    } catch (err) {
        console.error("Leaderboard route error:", err);
        res.status(500).send("Internal Server Error");
    }
});

app.get("/profile", (req, res) => {
    res.redirect("/dashboard");
});

app.get("/terms", (req, res)=>{
    res.render("pages/terms");
})

app.get("/contactus", (req, res)=>{
    res.render("pages/contactus");
})

app.get("/privacy-policy", (req, res)=>{
    res.render("pages/privacyPolicy");
})

app.get("/refund-policy", (req, res)=>{
    res.render("pages/refundPolicy");
})

app.get("/aboutus", (req, res)=>{
    res.render("pages/aboutUs");
})

app.get("/signin", (req, res)=>{
    res.render("pages/signin", { googleAuthUrl: "/auth/google" });
})

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] }));
 
app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/signin', successRedirect:'/dashboard' }),
  function(req, res) {
    // Successful authentication, redirect home.
    res.redirect('/');
  });

app.get("/withdrawal", authCheck, async (req, res)=>{
     try {
         let isExist = await userModel.findOne({gglId:req.user.id});
         if(!isExist){
             const add = await userModel.create({gglId:req.user.id, wallet:{ balance:{availableBalance:0, prizePool:0}, withdrawal:[]}});
             isExist = await add.save();
         }
         const user = {
            name:req.user.displayName,
            dp:req.user.photos[0].value,
            balance:isExist.wallet.balance
        }

        const withdrawalHistory = await withdrawalModel.find({id:req.user.id}).sort({_id: -1});
        console.log(withdrawalHistory);
        res.render("pages/withdrawal", {user, withdrawalHistory, baseurl});
     } catch (err) {
         console.error("Withdrawal error:", err);
         res.status(500).send("Internal Server Error");
     }
})

app.post("/withdrawal", authCheck, upload.single('qrImage'), async (req, res)=>{
    try {
        console.log(req.body);
        const { amount, payoutMethod, note } = req.body;
        const amountNum = Number(amount);
        if (isNaN(amountNum) || amountNum <= 0) {
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch(e) {}
            }
            return res.status(400).json({msg:"Invalid amount."});
        }

        let payoutDetail = req.body.payoutDetail;

        if (payoutMethod === 'qr') {
            if (!req.file) {
                return res.status(400).json({msg:"Please upload a QR code image."});
            }
            try {
                // Upload QR code to Cloudinary
                const uploadResult = await uploadToCloudinary(req.file.path, 'withdrawals');
                payoutDetail = uploadResult.secure_url;
            } catch (uploadErr) {
                console.error("Cloudinary upload failed:", uploadErr);
                return res.status(500).json({msg:"Failed to upload QR code. Please try again."});
            }
        } else {
            // If not qr, delete file if somehow uploaded
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch(e) {}
            }
        }

        const user = await userModel.findOne({ gglId: req.user.id });
        if (!user) {
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch(e) {}
            }
            return res.status(404).json({ msg: "User not found." });
        }

        const availableBalance = (user.wallet && user.wallet.balance && typeof user.wallet.balance.availableBalance !== 'undefined') ? Number(user.wallet.balance.availableBalance) : 0;
        const prizePool = (user.wallet && user.wallet.balance && typeof user.wallet.balance.prizePool !== 'undefined') ? Number(user.wallet.balance.prizePool) : 0;
        const totalBalance = availableBalance + prizePool;

        if (totalBalance < amountNum) {
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch(e) {}
            }
            return res.status(400).json({ msg: "Insufficient balance in your wallet. Total available: ₹" + totalBalance });
        }

        // Initialize structure to be safe
        if (!user.wallet) user.wallet = {};
        if (!user.wallet.balance) user.wallet.balance = { availableBalance: 0, prizePool: 0 };
        if (typeof user.wallet.balance.availableBalance === 'undefined') user.wallet.balance.availableBalance = 0;
        if (typeof user.wallet.balance.prizePool === 'undefined') user.wallet.balance.prizePool = 0;

        // Deduct split logic: First from prizePool, then remaining from availableBalance
        let prizePoolDeducted = 0;
        let availableBalanceDeducted = 0;

        if (prizePool >= amountNum) {
            user.wallet.balance.prizePool -= amountNum;
            prizePoolDeducted = amountNum;
        } else {
            const remaining = amountNum - prizePool;
            user.wallet.balance.prizePool = 0;
            prizePoolDeducted = prizePool;
            user.wallet.balance.availableBalance -= remaining;
            availableBalanceDeducted = remaining;
        }

        // Save the updated user balance
        await user.save();

        let result;
        try {
            const fulldetail = {
                payoutMethod,
                payoutDetail,
                note,
                amount: amountNum,
                status: "pending",
                playerName: req.user.displayName,
                id: req.user.id,
                prizePoolDeducted,
                availableBalanceDeducted,
                isDeducted: true
            };

            const addRequest = await withdrawalModel.create(fulldetail);
            result = await addRequest.save();
        } catch (dbErr) {
            // Revert deduction
            user.wallet.balance.prizePool += prizePoolDeducted;
            user.wallet.balance.availableBalance += availableBalanceDeducted;
            await user.save();
            throw dbErr;
        }

        if(result){
            return res.status(200).json({msg:"Request submited successfully, wait for approvel."});
        } else {
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch(e) {}
            }
            // Revert deduction
            user.wallet.balance.prizePool += prizePoolDeducted;
            user.wallet.balance.availableBalance += availableBalanceDeducted;
            await user.save();
            return res.status(500).json({msg:"Failed to submit request."});
        }
    } catch (err) {
        console.error("Withdrawal error:", err);
        if (req.file && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch(e) {}
        }
        return res.status(500).json({msg:"Internal server error"});
    }
})

/**
 * Helper function: Verify payment with Lola Pay and credit user wallet
 */
async function processOrderPayment(orderId) {
    if (!orderId) return { success: false, msg: "Missing order ID" };

    const depositReq = await depositModel.findOne({ orderId });
    if (!depositReq) {
        return { success: false, msg: "Deposit record not found for order: " + orderId };
    }

    // Prevent duplicate wallet crediting if already approved
    if (depositReq.status === "approved" || depositReq.status === "success") {
        return { success: true, alreadyProcessed: true, deposit: depositReq };
    }

    try {
        const response = await fetch("https://payment.ubresports.in/api/check-status", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": process.env.X_API_KEY,
                "X-API-Secret": process.env.X_API_SECRET
            },
            body: JSON.stringify({ order_id: orderId })
        });

        const json = await response.json();

        if (json.status === "success" && json.data) {
            const txn = json.data;

            if (txn.payment_status === "success") {
                depositReq.status = "approved";
                depositReq.utr = txn.utr || depositReq.utr || "";
                depositReq.gatewayTxnId = txn.gateway_txn_id || depositReq.gatewayTxnId || "";
                depositReq.provider = txn.provider || depositReq.provider || "paytm";
                depositReq.paymentMethod = txn.payment_method || depositReq.paymentMethod || "UPI QR";
                if (txn.paid_at) {
                    depositReq.paidAt = new Date(txn.paid_at);
                }
                await depositReq.save();

                // Add balance to user wallet availableBalance
                const updatedUser = await userModel.findOneAndUpdate(
                    { gglId: depositReq.id },
                    { $inc: { "wallet.balance.availableBalance": Number(depositReq.amount) } },
                    { new: true }
                );

                console.log(`Payment confirmed for Order ${orderId}: ₹${depositReq.amount} credited to user ${depositReq.id}`);
                return { success: true, deposit: depositReq, user: updatedUser };
            } else if (txn.payment_status === "failed") {
                depositReq.status = "failed";
                await depositReq.save();
                return { success: false, msg: "Payment failed at gateway", deposit: depositReq };
            }
        }

        return { success: false, msg: "Payment still pending or unverified", deposit: depositReq };
    } catch (err) {
        console.error("Error verifying Lola Pay order status:", err);
        return { success: false, msg: err.message };
    }
}

/**
 * 1. Add Cash Route - Initiates Lola Pay UPI QR Checkout
 */
app.post("/addcash", authCheck, async (req, res) => {
    try {
        const { amount } = req.body;
        const amountNum = Number(amount);

        if (isNaN(amountNum) || amountNum <= 0) {
            return res.status(400).json({ success: false, msg: "Please enter a valid amount greater than 0." });
        }

        const orderId = `ORD_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
        const customerName = req.user.displayName || req.user.name || "Player";
        const customerMobile = req.user.whatsappNumber ? String(req.user.whatsappNumber) : "";
        const callbackUrl = `${baseurl || 'https://ubresports.in'}/payment/callback`;

        const payload = {
            amount: amountNum.toFixed(2),
            order_id: orderId,
            customer_name: customerName,
            customer_mobile: customerMobile,
            description: "Wallet balance deposit",
            callback_url: callbackUrl,
            is_reusable: false
        };

        const response = await fetch("https://payment.ubresports.in/api/create-order", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": process.env.X_API_KEY,
                "X-API-Secret": process.env.X_API_SECRET
            },
            body: JSON.stringify(payload)
        });

        const json = await response.json();

        if (json.status === "success" && json.data && json.data.payment_url) {
            // Save pending deposit in database
            await depositModel.create({
                orderId: orderId,
                playerName: customerName,
                id: req.user.id, // user's gglId
                amount: amountNum,
                paymentUrl: json.data.payment_url,
                status: "pending",
                date: new Date()
            });

            return res.status(200).json({
                success: true,
                orderId: orderId,
                paymentUrl: json.data.payment_url,
                msg: "Payment link generated successfully. Redirecting..."
            });
        } else {
            console.error("Lola Pay Create Order Error:", json);
            return res.status(400).json({
                success: false,
                msg: json.error || json.message || "Failed to create payment order from gateway."
            });
        }
    } catch (err) {
        console.error("Add cash request error:", err);
        return res.status(500).json({ success: false, msg: "Internal server error." });
    }
});

/**
 * 2. Payment Callback Route - Handles customer redirection after payment
 */
app.get("/payment/callback", async (req, res) => {
    try {
        const { order_id, status } = req.query;

        if (!order_id) {
            return res.redirect("/?payment_status=failed");
        }

        const result = await processOrderPayment(order_id);

        if (result.success) {
            return res.redirect("/?payment_status=success");
        } else {
            return res.redirect("/?payment_status=pending");
        }
    } catch (err) {
        console.error("Payment callback error:", err);
        return res.redirect("/?payment_status=failed");
    }
});

/**
 * 3. Payment Webhook Route - Real-time async payment notifications from Lola Pay
 */
app.post("/payment/webhook", async (req, res) => {
    try {
        const signature =
            req.headers["x-payindia-signature"] ||
            req.headers["x-lola-pay-signature"] ||
            req.headers["x-payindia-signature".toLowerCase()];

        const webhookSecret = process.env.LOLA_PAY_WEBHOOK_SECRET;

        // If webhook secret configured, verify HMAC SHA-256 signature
        if (webhookSecret && signature) {
            const rawBody = req.rawBody || JSON.stringify(req.body);
            const expectedSignature = crypto
                .createHmac("sha256", webhookSecret)
                .update(rawBody)
                .digest("hex");

            if (signature !== expectedSignature) {
                console.warn("Lola Pay Webhook: Signature mismatch!");
                return res.status(400).send("Invalid Signature");
            }
        }

        const data = req.body || {};
        const orderId = data.order_id || (data.data && data.data.order_id);

        if (orderId) {
            await processOrderPayment(orderId);
        }

        return res.status(200).json({ received: true });
    } catch (err) {
        console.error("Lola Pay Webhook processing error:", err);
        return res.status(500).json({ error: "Webhook processing error" });
    }
});


app.get("/category/:id", async (req, res)=>{
    try {
         
        const {id} = req.params;
        console.log(id);
        const getMatch = await categoryModel.find({_id:id}).select("matches -_id");
        if (!getMatch || getMatch.length === 0) {
            return res.status(404).send("Category not found");
        }
        const matches = getMatch[0].matches || [];
        // Sort matches: available slots first, full slots at the bottom
        matches.sort((a, b) => {
            const aTeams = (a && a.teams && Array.isArray(a.teams)) ? a.teams.length : 0;
            const aSlots = (a && Number(a.slots)) || 0;
            const aFull = (aSlots > 0 && aTeams >= aSlots) ? 1 : 0;

            const bTeams = (b && b.teams && Array.isArray(b.teams)) ? b.teams.length : 0;
            const bSlots = (b && Number(b.slots)) || 0;
            const bFull = (bSlots > 0 && bTeams >= bSlots) ? 1 : 0;

            return aFull - bFull;
        });
        if (matches.length > 0) {
            console.log(matches[0].date);
            if (matches[0].idpTimings) {
                console.log(matches[0].idpTimings.split(","));
            }
        }
        
        let userTeamName = null;
        let userTeamNames = [];
        let userTeams = [];
        let wallet = null;

        if (req.isAuthenticated()) {
            const details = await userModel.findOne({gglId:req.user.id});
            if (details) {
                if (details.teams && Array.isArray(details.teams) && details.teams.length > 0) {
                    userTeams = details.teams;
                    userTeamNames = details.teams.map(t => t.teamName).filter(Boolean);
                    userTeamName = userTeamNames[0] || null;
                } else if (details.team && details.team.teamName) {
                    userTeamName = details.team.teamName;
                    userTeamNames = [details.team.teamName];
                    userTeams = [details.team];
                }
                wallet = details.wallet;
            }
        }
        res.render("pages/category", { matches, id, baseurl, userTeamName, userTeamNames, userTeams, wallet });
    } catch (err) {
        console.error("Error fetching category matches:", err);
        res.status(500).send("Internal Server Error");
    }
})

app.get("/dashboard", authCheck, async (req, res)=>{
    try {
        const categories = await categoryModel.find().select("-matches").sort({ order: 1, _id: 1 });

        let isExist = await userModel.findOne({gglId:req.user.id});
        if(!isExist){
            const newRefCode = await generateUniqueReferralCode();
            const displayName = req.user.displayName || "";
            const email = (req.user.emails && req.user.emails[0]) ? req.user.emails[0].value : (req.user._json && req.user._json.email ? req.user._json.email : "");
            const avatar = (req.user.photos && req.user.photos[0]) ? req.user.photos[0].value : "";

            const add = await userModel.create({
                gglId: req.user.id,
                name: displayName,
                email: email,
                avatar: avatar,
                referralCode: newRefCode,
                wallet: { balance: { availableBalance: 0, prizePool: 0 }, withdrawal: [] }
            });
            isExist = await add.save();
        } else {
            let needSave = false;
            if (!isExist.referralCode) {
                isExist.referralCode = await generateUniqueReferralCode();
                needSave = true;
            }
            if (!isExist.name && req.user.displayName) {
                isExist.name = req.user.displayName;
                needSave = true;
            }
            if (!isExist.email && req.user.emails && req.user.emails[0]) {
                isExist.email = req.user.emails[0].value;
                needSave = true;
            }
            if (req.user.photos && req.user.photos[0] && (!isExist.avatar || isExist.avatar !== req.user.photos[0].value)) {
                isExist.avatar = req.user.photos[0].value;
                needSave = true;
            }
            if (needSave) {
                await isExist.save();
            }
        }

        // Link referral if candidate referral code exists in session or cookie and not already linked
        if (!isExist.referredBy) {
            let candidateRef = (req.session && req.session.referralCode) ? req.session.referralCode : null;
            if (!candidateRef && req.headers && req.headers.cookie) {
                const match = req.headers.cookie.match(/(?:^|;\s*)ubr_ref=([^;]+)/);
                if (match) candidateRef = decodeURIComponent(match[1]).trim().toUpperCase();
            }
            if (candidateRef) {
                await linkReferral(isExist, candidateRef);
                if (req.session) req.session.referralCode = null;
                res.clearCookie("ubr_ref");
                isExist = await userModel.findOne({ gglId: req.user.id });
            }
        }

        if (isExist.teams && Array.isArray(isExist.teams) && isExist.teams.length > 0) {
            for (const t of isExist.teams) {
                if (t && t.teamName) await syncTeamStats(t.teamName);
            }
            isExist = await userModel.findOne({ gglId: req.user.id });
        } else if (isExist.team && isExist.team.teamName) {
            await syncTeamStats(isExist.team.teamName);
            isExist = await userModel.findOne({ gglId: req.user.id });
        }

        // Fetch user's referral statistics & invited friends list
        const referralList = await referralModel.find({ referrer: isExist._id })
            .populate("referee", "name email avatar team createdAt")
            .sort({ createdAt: -1 });

        const totalReferrals = referralList.length;
        const completedReferrals = referralList.filter(r => r.status === "completed").length;
        const pendingReferrals = referralList.filter(r => r.status === "pending").length;
        const totalEarned = completedReferrals * 10;

        let referrerName = "";
        if (isExist.referredBy) {
            const refUser = await userModel.findById(isExist.referredBy).select("name");
            if (refUser && refUser.name) referrerName = refUser.name;
        }

        const siteUrl = baseurl || (req.protocol + '://' + req.get('host'));

        const referralData = {
            referralCode: isExist.referralCode,
            totalReferrals,
            completedReferrals,
            pendingReferrals,
            totalEarned,
            list: referralList,
            referredBy: isExist.referredBy,
            referrerName,
            siteUrl
        };

        const user = {
            id: isExist._id,
            name: req.user.displayName,
            dp: (req.user.photos && req.user.photos[0]) ? req.user.photos[0].value : null,
            email: (req.user.emails && req.user.emails[0]) ? req.user.emails[0].value : (req.user._json && req.user._json.email ? req.user._json.email : null),
            balance: isExist.wallet.balance,
            team: isExist.team || {},
            dropDetails: isExist.dropDetails || {},
            referralCode: isExist.referralCode,
            referredBy: isExist.referredBy
        };

        res.render("pages/dashboard", { user, categories, referralData, baseurl: siteUrl });
    } catch (err) {
        console.error("Dashboard error:", err);
        res.status(500).send("Internal Server Error");
    }
})

app.get("/my-matches", authCheck, async (req, res) => {
    try {
        let isExist = await userModel.findOne({ gglId: req.user.id });
        if (!isExist) {
            const add = await userModel.create({
                gglId: req.user.id,
                wallet: { balance: { availableBalance: 0, prizePool: 0 }, withdrawal: [] }
            });
            isExist = await add.save();
        }

        const user = {
            name: req.user.displayName,
            dp: (req.user.photos && req.user.photos[0]) ? req.user.photos[0].value : null,
            email: (req.user.emails && req.user.emails[0]) ? req.user.emails[0].value : (req.user._json && req.user._json.email ? req.user._json.email : null),
            balance: isExist.wallet ? isExist.wallet.balance : { availableBalance: 0, prizePool: 0 },
            team: isExist.team || {},
            dropDetails: isExist.dropDetails || {}
        };

        const userTeamsList = (isExist.teams && Array.isArray(isExist.teams) && isExist.teams.length > 0)
            ? isExist.teams
            : ((isExist.team && isExist.team.teamName) ? [isExist.team] : []);

        const userTeamNames = userTeamsList.map(t => t.teamName ? t.teamName.trim().toLowerCase() : null).filter(Boolean);
        const userTeamIds = userTeamsList.map(t => t._id ? t._id.toString() : null).filter(Boolean);

        const myMatches = [];

        if (userTeamNames.length > 0 || userTeamIds.length > 0) {
            const orConditions = [];
            userTeamNames.forEach(name => {
                const escapedTeam = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                orConditions.push({ "matches.teams.teamName": new RegExp(`^${escapedTeam}$`, 'i') });
            });
            userTeamIds.forEach(id => {
                if (mongoose.Types.ObjectId.isValid(id)) {
                    orConditions.push({ "matches.teams._id": new mongoose.Types.ObjectId(id) });
                    orConditions.push({ "matches.teams.teamId": new mongoose.Types.ObjectId(id) });
                }
            });
            if (user && user._id) {
                orConditions.push({ "matches.teams.userId": user._id });
            }

            if (orConditions.length > 0) {
                const categories = await categoryModel.find({ $or: orConditions });

                for (const cat of categories) {
                    if (!cat.matches || !Array.isArray(cat.matches)) continue;
                    for (const m of cat.matches) {
                        if (!m.teams || !Array.isArray(m.teams)) continue;

                        m.teams.forEach((t, idx) => {
                            const isUserTeam = (t._id && userTeamIds.includes(t._id.toString())) ||
                                               (t.teamId && userTeamIds.includes(t.teamId.toString())) ||
                                               (user && user._id && t.userId && t.userId.toString() === user._id.toString()) ||
                                               (t.teamName && userTeamNames.includes(t.teamName.trim().toLowerCase()));
                            if (isUserTeam) {
                                const approvedTeams = m.teams.filter(team => team.status === "approved" || !team.status);

                                myMatches.push({
                                    categoryId: cat._id,
                                    categoryTitle: cat.title,
                                    categoryImg: cat.img,
                                    matchId: m._id,
                                    title: m.title,
                                    date: m.date,
                                    prizePool: m.prizePool || 0,
                                    slots: m.slots || 0,
                                    entryFee: m.entryFee || 0,
                                    idpTimings: m.idpTimings || "",
                                    maps: m.maps || "",
                                    details: m.details || "",
                                    whatsappGroupLink: m.whatsappGroupLink || "",
                                    teams: m.teams,
                                    approvedTeams: approvedTeams,
                                    userSlotNo: idx + 1,
                                    userTeamData: t,
                                    teamStatus: t.status || "registered",
                                    isTournament: false
                                });
                            }
                        });
                    }
                }
            }

            // Also fetch tournaments joined by any of user's squads
            const tournamentOrConditions = [];
            userTeamNames.forEach(name => {
                const escapedTeam = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                tournamentOrConditions.push({ "teams.teamName": new RegExp(`^${escapedTeam}$`, 'i') });
            });
            userTeamIds.forEach(id => {
                if (mongoose.Types.ObjectId.isValid(id)) {
                    tournamentOrConditions.push({ "teams._id": new mongoose.Types.ObjectId(id) });
                    tournamentOrConditions.push({ "teams.teamId": new mongoose.Types.ObjectId(id) });
                }
            });
            if (user && user._id) {
                tournamentOrConditions.push({ "teams.userId": user._id });
            }

            if (tournamentOrConditions.length > 0) {
                const tournaments = await tournamentModel.find({ $or: tournamentOrConditions });

                for (const tourn of tournaments) {
                    if (!tourn.teams || !Array.isArray(tourn.teams)) continue;

                    tourn.teams.forEach((t, idx) => {
                        const isUserTeam = (t._id && userTeamIds.includes(t._id.toString())) ||
                                           (t.teamId && userTeamIds.includes(t.teamId.toString())) ||
                                           (user && user._id && t.userId && t.userId.toString() === user._id.toString()) ||
                                           (t.teamName && userTeamNames.includes(t.teamName.trim().toLowerCase()));
                        if (isUserTeam) {
                            const approvedTeams = tourn.teams.filter(team => team.status === "approved" || !team.status);

                            myMatches.push({
                                categoryId: null,
                                categoryTitle: "Official Tournament",
                                categoryImg: tourn.banner || "/images/ubrLogo.png",
                                tournamentId: tourn._id,
                                matchId: tourn._id,
                                title: tourn.title,
                                date: tourn.date,
                                prizePool: tourn.prizePool || 0,
                                slots: tourn.slots || 0,
                                entryFee: tourn.entryFee || 0,
                                idpTimings: tourn.idpTimings || "",
                                maps: tourn.maps || "",
                                details: tourn.details || "",
                                whatsappGroupLink: tourn.whatsappGroupLink || "",
                                teams: tourn.teams,
                                approvedTeams: approvedTeams,
                                userSlotNo: idx + 1,
                                userTeamData: t,
                                teamStatus: t.status || "registered",
                                isTournament: true
                            });
                        }
                    });
                }
            }
        }

        // Sort: newest/upcoming match date first
        myMatches.sort((a, b) => {
            const dateA = new Date(a.date).getTime() || 0;
            const dateB = new Date(b.date).getTime() || 0;
            return dateB - dateA;
        });

        res.render("pages/myMatches", {
            user,
            matches: myMatches,
            wallet: isExist.wallet,
            userTeamName: isExist.team ? isExist.team.teamName : null,
            baseurl
        });
    } catch (err) {
        console.error("My Matches error:", err);
        res.status(500).send("Internal Server Error");
    }
});

app.get("/mymatches", (req, res) => {
    res.redirect("/my-matches");
});

app.get("/matches", (req, res) => {
    res.redirect("/my-matches");
});

app.get("/team-settings", authCheck, async (req, res)=>{
     try {
         let isExist = await userModel.findOne({gglId:req.user.id});
         if(!isExist){
             isExist = await userModel.create({gglId:req.user.id, wallet:{ balance:{availableBalance:0, prizePool:0}, withdrawal:[]}});
         }

         // Auto-migrate legacy single team if teams array is empty
         if (isExist.team && isExist.team.teamName && (!isExist.teams || isExist.teams.length === 0)) {
             isExist.teams = [{
                 _id: isExist.team._id || new mongoose.Types.ObjectId(),
                 teamName: isExist.team.teamName,
                 teamLogo: isExist.team.teamLogo || "",
                 whatsappNumber: isExist.team.whatsappNumber || null,
                 totalPoints: isExist.team.totalPoints || 0,
                 totalFinishes: isExist.team.totalFinishes || 0,
                 placementPoints: isExist.team.placementPoints || 0,
                 matchesPlayed: isExist.team.matchesPlayed || 0,
                 chickenDinners: isExist.team.chickenDinners || 0
             }];
             await isExist.save().catch(e => console.error("Migration error:", e));
         }

         const user = {
            name:req.user.displayName,
            dp:(req.user.photos && req.user.photos[0]) ? req.user.photos[0].value : null,
            balance:isExist.wallet ? isExist.wallet.balance : { availableBalance: 0, prizePool: 0 }
         }

         const teams = (isExist.teams && Array.isArray(isExist.teams)) ? isExist.teams : [];
         const team = teams.length > 0 ? teams[0] : (isExist.team || {});

         res.render("pages/teamSettings", {user, teams, team, baseurl});
     } catch (err) {
         console.error("Team settings error:", err);
         res.status(500).send("Internal Server Error");
     }
})

app.post("/team-settings", authCheck, upload.single('teamLogo'), async (req, res)=>{
    try {
        const user = await userModel.findOne({gglId: req.user.id});
        if(!user){
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch(e) {}
            }
            return res.status(404).json({msg:"User does not exist"});
        }

        const { teamName, whatsappNumber, teamId } = req.body;
        if (!teamName || !whatsappNumber) {
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch(e) {}
            }
            return res.status(400).json({ msg: "Please fill all required fields." });
        }

        if (!user.teams) {
            user.teams = [];
        }

        let teamIndex = -1;
        if (teamId && teamId !== 'new') {
            teamIndex = user.teams.findIndex(t => t._id && t._id.toString() === teamId.toString());
            if (teamIndex === -1) {
                if (req.file && fs.existsSync(req.file.path)) {
                    try { fs.unlinkSync(req.file.path); } catch(e) {}
                }
                return res.status(404).json({ msg: "Squad not found." });
            }
        }

        // Check if updating an existing team
        if (teamIndex !== -1) {
            const oldTeam = user.teams[teamIndex];
            const oldTeamName = (oldTeam && oldTeam.teamName) ? oldTeam.teamName.trim() : "";
            const targetTeamId = oldTeam ? oldTeam._id : null;
            const oldLogo = (oldTeam && oldTeam.teamLogo) ? oldTeam.teamLogo : "";
            const oldWhatsapp = oldTeam ? oldTeam.whatsappNumber : null;
            const newTeamName = teamName.trim();
            const newWhatsapp = Number(whatsappNumber);

            let logoName = oldLogo;
            if (req.file) {
                if (logoName) {
                    if (logoName.startsWith("http://") || logoName.startsWith("https://")) {
                        await deleteFromCloudinary(logoName).catch(e => console.error("Cloudinary delete error:", e));
                    } else {
                        const oldLogoPath = path.join(__dirname, 'public', 'images', logoName);
                        if (fs.existsSync(oldLogoPath)) {
                            try { fs.unlinkSync(oldLogoPath); } catch(e) {}
                        }
                    }
                }
                try {
                    const uploadResult = await uploadToCloudinary(req.file.path, 'team_logos');
                    logoName = uploadResult ? uploadResult.secure_url : oldLogo;
                } catch (uploadErr) {
                    console.error("Cloudinary upload failed for squad logo update:", uploadErr);
                    if (req.file && fs.existsSync(req.file.path)) {
                        try { fs.unlinkSync(req.file.path); } catch(e) {}
                    }
                    return res.status(500).json({ 
                        msg: "Failed to upload squad logo: " + (uploadErr.message || "Please check Cloudinary configuration on server.") 
                    });
                }
            }

            user.teams[teamIndex].teamName = newTeamName;
            user.teams[teamIndex].whatsappNumber = newWhatsapp;
            user.teams[teamIndex].teamLogo = logoName;

            // Sync user.team to primary team
            user.team = user.teams[0];
            await user.save();

            // Synchronize updated team details across all booked scrim matches and tournaments
            try {
                const isMatchingSquad = (t) => {
                    if (!t) return false;
                    if (targetTeamId && t.teamId && t.teamId.toString() === targetTeamId.toString()) return true;
                    if (targetTeamId && t._id && t._id.toString() === targetTeamId.toString()) return true;
                    if (user._id && t.userId && t.userId.toString() === user._id.toString()) {
                        if (!oldTeamName || (t.teamName && t.teamName.trim().toLowerCase() === oldTeamName.toLowerCase())) return true;
                    }
                    if (oldTeamName && t.teamName && t.teamName.trim().toLowerCase() === oldTeamName.toLowerCase()) {
                        if (t.userId && user._id && t.userId.toString() === user._id.toString()) return true;
                        if (oldWhatsapp && t.whatsappNumber && Number(t.whatsappNumber) === Number(oldWhatsapp)) return true;
                        if (oldLogo && t.teamLogo && t.teamLogo === oldLogo) return true;
                        if (!t.userId && (!t.whatsappNumber || Number(t.whatsappNumber) === Number(newWhatsapp))) return true;
                    }
                    return false;
                };

                // 1. Sync Scrim Matches in Category Model
                const categoryOrs = [];
                if (targetTeamId) {
                    categoryOrs.push({ "matches.teams.teamId": targetTeamId });
                    categoryOrs.push({ "matches.teams._id": targetTeamId });
                }
                if (user._id) {
                    categoryOrs.push({ "matches.teams.userId": user._id });
                }
                if (oldTeamName) {
                    const escaped = oldTeamName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    categoryOrs.push({ "matches.teams.teamName": new RegExp(`^${escaped}$`, 'i') });
                }

                if (categoryOrs.length > 0) {
                    const matchedCategories = await categoryModel.find({ $or: categoryOrs });
                    for (const cat of matchedCategories) {
                        let catModified = false;
                        if (cat.matches && Array.isArray(cat.matches)) {
                            cat.matches.forEach(m => {
                                if (m.teams && Array.isArray(m.teams)) {
                                    m.teams.forEach(t => {
                                        if (isMatchingSquad(t)) {
                                            t.teamName = newTeamName;
                                            t.whatsappNumber = newWhatsapp;
                                            t.teamLogo = logoName;
                                            if (targetTeamId) t.teamId = targetTeamId;
                                            if (user._id) t.userId = user._id;
                                            catModified = true;
                                        }
                                    });
                                }
                            });
                        }
                        if (catModified) {
                            await cat.save();
                        }
                    }
                }

                // 2. Sync Tournaments
                const tournamentOrs = [];
                if (targetTeamId) {
                    tournamentOrs.push({ "teams.teamId": targetTeamId });
                    tournamentOrs.push({ "teams._id": targetTeamId });
                }
                if (user._id) {
                    tournamentOrs.push({ "teams.userId": user._id });
                }
                if (oldTeamName) {
                    const escaped = oldTeamName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    tournamentOrs.push({ "teams.teamName": new RegExp(`^${escaped}$`, 'i') });
                }

                if (tournamentOrs.length > 0) {
                    const matchedTournaments = await tournamentModel.find({ $or: tournamentOrs });
                    for (const tourn of matchedTournaments) {
                        let tourModified = false;
                        if (tourn.teams && Array.isArray(tourn.teams)) {
                            tourn.teams.forEach(t => {
                                if (isMatchingSquad(t)) {
                                    t.teamName = newTeamName;
                                    t.whatsappNumber = newWhatsapp;
                                    t.teamLogo = logoName;
                                    if (targetTeamId) t.teamId = targetTeamId;
                                    if (user._id) t.userId = user._id;
                                    tourModified = true;
                                }
                            });
                        }
                        if (tourModified) {
                            await tourn.save();
                        }
                    }
                }
            } catch (syncErr) {
                console.error("Error synchronizing team name to scrims/tournaments:", syncErr);
            }

            return res.status(200).json({ msg: "Squad updated successfully." });
        } else {
            // Adding a new team: Check max 4 limit
            if (user.teams.length >= 4) {
                if (req.file && fs.existsSync(req.file.path)) {
                    try { fs.unlinkSync(req.file.path); } catch(e) {}
                }
                return res.status(400).json({ msg: "You can create a maximum of 4 teams." });
            }

            let logoName = "";
            if (req.file) {
                try {
                    const uploadResult = await uploadToCloudinary(req.file.path, 'team_logos');
                    logoName = uploadResult ? uploadResult.secure_url : "";
                } catch (uploadErr) {
                    console.error("Cloudinary upload failed for new squad:", uploadErr);
                    if (req.file && fs.existsSync(req.file.path)) {
                        try { fs.unlinkSync(req.file.path); } catch(e) {}
                    }
                    return res.status(500).json({ 
                        msg: "Failed to upload squad logo: " + (uploadErr.message || "Please check Cloudinary configuration on server.") 
                    });
                }
            }

            const newTeam = {
                _id: new mongoose.Types.ObjectId(),
                teamName: teamName.trim(),
                whatsappNumber: Number(whatsappNumber),
                teamLogo: logoName,
                totalPoints: 0,
                totalFinishes: 0,
                placementPoints: 0,
                matchesPlayed: 0,
                chickenDinners: 0
            };

            user.teams.push(newTeam);
            user.team = user.teams[0];
            await user.save();

            return res.status(200).json({ msg: "Squad created successfully." });
        }
    } catch(err) {
        console.error("Error setting team details:", err);
        if (req.file && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch(e) {}
        }
        return res.status(500).json({ msg: err.message || "Internal server error" });
    }
})

app.post("/team-settings/delete", authCheck, async (req, res) => {
    try {
        const { teamId } = req.body;
        if (!teamId) {
            return res.status(400).json({ msg: "Team ID is required." });
        }

        const user = await userModel.findOne({ gglId: req.user.id });
        if (!user) {
            return res.status(404).json({ msg: "User not found." });
        }

        const teamIndex = user.teams ? user.teams.findIndex(t => t._id && t._id.toString() === teamId.toString()) : -1;
        if (teamIndex === -1) {
            return res.status(404).json({ msg: "Squad not found." });
        }

        const removedTeam = user.teams[teamIndex];
        if (removedTeam && removedTeam.teamLogo) {
            if (removedTeam.teamLogo.startsWith("http://") || removedTeam.teamLogo.startsWith("https://")) {
                await deleteFromCloudinary(removedTeam.teamLogo).catch(e => console.error("Cloudinary delete error:", e));
            }
        }

        user.teams.splice(teamIndex, 1);
        user.team = (user.teams && user.teams.length > 0) ? user.teams[0] : {};
        await user.save();

        return res.status(200).json({ msg: "Squad deleted successfully." });
    } catch (err) {
        console.error("Error deleting squad:", err);
        return res.status(500).json({ msg: "Internal server error." });
    }
});

app.get("/drop-details", authCheck, async (req, res)=>{
     try {
         let isExist = await userModel.findOne({gglId:req.user.id});
         if(!isExist){
             isExist = await userModel.create({gglId:req.user.id, wallet:{ balance:{availableBalance:0, prizePool:0}, withdrawal:[]}});
         }
         const user = {
            name:req.user.displayName,
            dp:req.user.photos[0].value,
            balance:isExist.wallet.balance
         }

         const dropDetails = isExist.dropDetails || { erangle: "", rando: "", miramar: "" };
         res.render("pages/dropDetails", {user, dropDetails, baseurl});
     } catch (err) {
         console.error("Drop details error:", err);
         res.status(500).send("Internal Server Error");
     }
})

app.post("/drop-details", authCheck, async (req, res)=>{
    try {
        const isExist = await userModel.findOne({gglId:req.user.id});
        if(!isExist){
            return res.status(404).json({msg:"User does not exist"});
        }

        const updateDrop = await userModel.findOneAndUpdate({gglId:req.user.id}, { dropDetails:req.body }, {new: true});
        if(!updateDrop){
            return res.status(500).json({msg:"something went wrong in updating drop details please try again later"});
        }
        return res.status(200).json("Drop Details Updated Successfully");
    } catch (err) {
        console.error("Error saving drop details:", err);
        return res.status(500).json({msg:"Internal server error"});
    }
})

app.get("/logout", (req, res)=>{
    req.logout(()=>{
        res.redirect('/');
    })
})

app.post("/book", upload.none(), async (req, res)=>{
     if (!req.isAuthenticated()) {
        return res.status(401).json({ authenticated: false });
    }
    
   try {
       const user = await userModel.findOne({gglId:req.user.id});
       if (!user) {
           return res.status(404).json({ msg: "User not found." });
       }

       const userTeams = (user.teams && Array.isArray(user.teams) && user.teams.length > 0)
           ? user.teams
           : ((user.team && user.team.teamName) ? [user.team] : []);

       const { id, title, matchid, teamId } = req.body;

       let selectedTeam = null;
       if (teamId) {
           selectedTeam = userTeams.find(t => t._id && t._id.toString() === teamId.toString());
       }
       if (!selectedTeam && userTeams.length > 0) {
           selectedTeam = userTeams[0];
       }

       if (!selectedTeam || !selectedTeam.teamName) {
           return res.status(400).json({msg:"Please set up your squad in team settings first."});
       }

       // Fetch category and match details from DB
       const category = await categoryModel.findOne({_id:id});
       if(!category){
         if (req.file) fs.unlinkSync(req.file.path);
         return res.status(404).json({msg:"This category does not exist."})
       }
       const match = category.matches.find(m => m._id.toString() === matchid || m.id === matchid);
       if(!match){
         if (req.file) fs.unlinkSync(req.file.path);
         return res.status(404).json({msg:"This match does not exist."})
       }
       const entryFee = Number(match.entryFee) || 0;

       // Check if slots are full
       if (match.teams && match.teams.length >= match.slots) {
           if (req.file) fs.unlinkSync(req.file.path);
           return res.status(400).json({msg:"Scrim slots are already full!"});
       }
 
       const drop = await userModel.findOne({gglId:req.user.id}).select("dropDetails");
       if(!drop || !drop.dropDetails){
         if (req.file) fs.unlinkSync(req.file.path);
         return res.status(400).json({msg:"Please add Drop Details "});
       };
 
       const isAlreadyRegistered = match.teams && match.teams.some(t =>
           isBookedSquadForUserTeam(t, selectedTeam, user._id)
       );
       if(isAlreadyRegistered){
         if (req.file) fs.unlinkSync(req.file.path);
         return res.status(409).json({msg: `Squad '${selectedTeam.teamName}' has already booked this match.`});
       }

       const erangle = drop.dropDetails.erangle;
       const rando = drop.dropDetails.rando;
       const miramar = drop.dropDetails.miramar;

       const teamObj = selectedTeam.toObject ? selectedTeam.toObject() : selectedTeam;
       const fullteam = {
            _id: teamObj._id || new mongoose.Types.ObjectId(),
            teamId: teamObj._id || null,
            userId: user._id,
            teamName: teamObj.teamName,
            teamLogo: teamObj.teamLogo || "",
            whatsappNumber: teamObj.whatsappNumber,
            erangle: erangle || "",
            rando: rando || "",
            miramar: miramar || ""
       };

        let deductAvailable = 0;
        let deductPrize = 0;

         // Check if user has sufficient wallet balance and deduct atomically
         if (entryFee > 0) {
             const availableBalance = (user && user.wallet && user.wallet.balance && typeof user.wallet.balance.availableBalance !== 'undefined') ? Number(user.wallet.balance.availableBalance) : 0;
             const prizePool = (user && user.wallet && user.wallet.balance && typeof user.wallet.balance.prizePool !== 'undefined') ? Number(user.wallet.balance.prizePool) : 0;

             if (availableBalance + prizePool < entryFee) {
                 if (req.file) fs.unlinkSync(req.file.path);
                 return res.status(400).json({ msg: "Insufficient balance in your wallet. Available: ₹" + availableBalance + ", Prizepool: ₹" + prizePool + ", Required: ₹" + entryFee });
             }

             if (availableBalance >= entryFee) {
                 deductAvailable = entryFee;
             } else {
                 deductAvailable = availableBalance;
                 deductPrize = entryFee - availableBalance;
             }

             // Deduct the entry fee atomically
             const updateWallet = await userModel.findOneAndUpdate(
                 { 
                     gglId: req.user.id, 
                     "wallet.balance.availableBalance": { $gte: deductAvailable },
                     "wallet.balance.prizePool": { $gte: deductPrize }
                 },
                 { 
                     $inc: { 
                         "wallet.balance.availableBalance": -deductAvailable,
                         "wallet.balance.prizePool": -deductPrize
                     } 
                 },
                 { new: true }
             );

             if (!updateWallet) {
                 if (req.file) fs.unlinkSync(req.file.path);
                 return res.status(400).json({ msg: "Insufficient balance in your wallet." });
             }
         }
   
         // Save the team. Ensure we only push if the team is not already in the teams array of this specific match
         const saveTeam = await categoryModel.findOneAndUpdate(
             { 
                 _id: id, 
                 matches: { 
                     $elemMatch: { 
                         _id: matchid,
                         "teams.teamName": { $ne: fullteam.teamName }
                     } 
                 } 
             },
             { $push: { "matches.$.teams": fullteam } },
             { returnDocument: 'after' }
         );
   
         if(saveTeam){
             // Reward referrer if referee's first match/slot
             await checkAndRewardReferral(user._id, matchid, "scrim");
             const updatedMatch = saveTeam.matches ? saveTeam.matches.find(m => m._id.toString() === matchid.toString() || m.id === matchid) : null;
             const slotNumber = updatedMatch && Array.isArray(updatedMatch.teams)
                 ? (updatedMatch.teams.findIndex(t => t.teamName === fullteam.teamName) + 1 || updatedMatch.teams.length)
                 : 1;
             return res.status(200).json({
                 msg: `Slot booked successfully for squad '${fullteam.teamName}'.`, 
                 whatsappGroupLink: match.whatsappGroupLink || "",
                 slotNumber: slotNumber
             });
         } else {
             // Refund the entry fee if it was deducted
             if (entryFee > 0) {
                 await userModel.findOneAndUpdate(
                     { gglId: req.user.id },
                     { 
                         $inc: { 
                             "wallet.balance.availableBalance": deductAvailable,
                             "wallet.balance.prizePool": deductPrize
                         } 
                     }
                 );
             }
             if (req.file) fs.unlinkSync(req.file.path);
             return res.status(500).json({msg:"Failed to book slot."});
         }
   } catch (err) {
       console.error("Booking error:", err);
       if (req.file) {
           try { fs.unlinkSync(req.file.path); } catch(e) {}
       }
       return res.status(500).json({msg:"Internal server error during booking."});
   }
})

app.post("/book-tournament", upload.none(), async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ authenticated: false });
    }

    try {
        const user = await userModel.findOne({ gglId: req.user.id });
        if (!user) {
            return res.status(404).json({ msg: "User not found." });
        }

        const userTeams = (user.teams && Array.isArray(user.teams) && user.teams.length > 0)
            ? user.teams
            : ((user.team && user.team.teamName) ? [user.team] : []);

        const { id, tournamentId, teamId } = req.body;
        const tId = tournamentId || id;
        if (!tId) {
            return res.status(400).json({ msg: "Tournament ID is required." });
        }

        let selectedTeam = null;
        if (teamId) {
            selectedTeam = userTeams.find(t => t._id && t._id.toString() === teamId.toString());
        }
        if (!selectedTeam && userTeams.length > 0) {
            selectedTeam = userTeams[0];
        }

        if (!selectedTeam || !selectedTeam.teamName) {
            return res.status(400).json({ msg: "Please set up your squad in team settings first." });
        }

        const tournament = await tournamentModel.findById(tId);
        if (!tournament) {
            return res.status(404).json({ msg: "This tournament does not exist." });
        }

        const entryFee = Number(tournament.entryFee) || 0;

        // Check if slots are full
        if (tournament.teams && tournament.teams.length >= tournament.slots) {
            return res.status(400).json({ msg: "Tournament slots are already full!" });
        }

        const drop = await userModel.findOne({ gglId: req.user.id }).select("dropDetails");
        if (!drop || !drop.dropDetails) {
            return res.status(400).json({ msg: "Please add Drop Details " });
        }

        // Check if already registered
        const selTournamentTeamId = (selectedTeam._id && selectedTeam._id.toString()) || '';
        const selTournamentTeamName = (selectedTeam.teamName && selectedTeam.teamName.toString().trim().toLowerCase()) || '';
        const alreadyBooked = tournament.teams && tournament.teams.some(t => {
            const tId = (t._id && t._id.toString()) || '';
            const tTeamId = (t.teamId && t.teamId.toString()) || '';
            const tName = (t.teamName && t.teamName.toString().trim().toLowerCase()) || '';
            return (selTournamentTeamId && (tId === selTournamentTeamId || tTeamId === selTournamentTeamId)) ||
                   (selTournamentTeamName && tName === selTournamentTeamName);
        });
        if (alreadyBooked) {
            return res.status(409).json({ msg: `Squad '${selectedTeam.teamName}' has already booked this tournament.` });
        }

        const erangle = drop.dropDetails.erangle;
        const rando = drop.dropDetails.rando;
        const miramar = drop.dropDetails.miramar;

        const teamObj = selectedTeam.toObject ? selectedTeam.toObject() : selectedTeam;
        const fullteam = {
            _id: teamObj._id || new mongoose.Types.ObjectId(),
            teamId: teamObj._id || null,
            userId: user._id,
            teamName: teamObj.teamName,
            teamLogo: teamObj.teamLogo || "",
            whatsappNumber: teamObj.whatsappNumber,
            erangle: erangle || "",
            rando: rando || "",
            miramar: miramar || "",
            dropDetails: {
                erangle: erangle || "",
                rando: rando || "",
                miramar: miramar || ""
            },
            joinedAt: new Date()
        };

        let deductAvailable = 0;
        let deductPrize = 0;

        // Check wallet balance and deduct atomically
        if (entryFee > 0) {
            const availableBalance = (user && user.wallet && user.wallet.balance && typeof user.wallet.balance.availableBalance !== 'undefined') ? Number(user.wallet.balance.availableBalance) : 0;
            const prizePool = (user && user.wallet && user.wallet.balance && typeof user.wallet.balance.prizePool !== 'undefined') ? Number(user.wallet.balance.prizePool) : 0;

            if (availableBalance + prizePool < entryFee) {
                return res.status(400).json({ msg: "Insufficient balance in your wallet. Available: ₹" + availableBalance + ", Prizepool: ₹" + prizePool + ", Required: ₹" + entryFee });
            }

            if (availableBalance >= entryFee) {
                deductAvailable = entryFee;
            } else {
                deductAvailable = availableBalance;
                deductPrize = entryFee - availableBalance;
            }

            const updateWallet = await userModel.findOneAndUpdate(
                { 
                    gglId: req.user.id, 
                    "wallet.balance.availableBalance": { $gte: deductAvailable },
                    "wallet.balance.prizePool": { $gte: deductPrize }
                },
                { 
                    $inc: { 
                        "wallet.balance.availableBalance": -deductAvailable,
                        "wallet.balance.prizePool": -deductPrize
                    } 
                },
                { new: true }
            );

            if (!updateWallet) {
                return res.status(400).json({ msg: "Insufficient balance in your wallet." });
            }
        }

        // Push team only if not already in teams array
        const saveTeam = await tournamentModel.findOneAndUpdate(
            { 
                _id: tId, 
                "teams.teamName": { $ne: fullteam.teamName } 
            },
            { $push: { teams: fullteam } },
            { returnDocument: 'after' }
        );

        if (saveTeam) {
            // Reward referrer if referee's first match/slot
            await checkAndRewardReferral(user._id, tId, "tournament");
            const slotNumber = Array.isArray(saveTeam.teams)
                ? (saveTeam.teams.findIndex(t => t.teamName === fullteam.teamName) + 1 || saveTeam.teams.length)
                : 1;
            return res.status(200).json({ 
                msg: `Slot booked successfully for squad '${fullteam.teamName}'.`, 
                whatsappGroupLink: tournament.whatsappGroupLink || "",
                slotNumber: slotNumber
            });
        } else {
            // Refund if entry fee was deducted
            if (entryFee > 0) {
                await userModel.findOneAndUpdate(
                    { gglId: req.user.id },
                    { 
                        $inc: { 
                            "wallet.balance.availableBalance": deductAvailable,
                            "wallet.balance.prizePool": deductPrize
                        } 
                    }
                );
            }
            return res.status(500).json({ msg: "Failed to book slot." });
        }
    } catch (err) {
        console.error("Tournament booking error:", err);
        return res.status(500).json({ msg: "Internal server error during booking." });
    }
});

app.get("/point-table", async (req, res) => {
    try {
        const pointTables = await pointTableModel.find().sort({ _id: -1 });
        console.log("point table testing")
        res.render("client/pages/pointtable", { pointTables, baseurl });
    } catch (err) {
        console.error("Error rendering point table page:", err);
        res.status(500).send("Internal Server Error");
    }
});

/* Admin Control Panel Routes */
app.get("/admin", adminAuthCheck, (req, res)=>{
    res.redirect("/admin/dashboard");
})

app.get("/admin/dashboard", adminAuthCheck,  async (req, res)=>{
    try{
        const users = await userModel.find();
        const categories = await categoryModel.find();
        const rawWithdrawal = await withdrawalModel.find({status:"pending"});

        const withdrawal = await Promise.all(rawWithdrawal.map(async (w) => {
            const wObj = w.toObject();
            const user = await userModel.findOne({ gglId: wObj.id });
            if (user) {
                const available = (user.wallet && user.wallet.balance && typeof user.wallet.balance.availableBalance !== 'undefined') ? Number(user.wallet.balance.availableBalance) : 0;
                const prize = (user.wallet && user.wallet.balance && typeof user.wallet.balance.prizePool !== 'undefined') ? Number(user.wallet.balance.prizePool) : 0;
                const total = available + prize;
                
                wObj.userTotalBalance = total;
                if (wObj.isDeducted) {
                    wObj.hasEnoughBalance = true;
                } else {
                    wObj.hasEnoughBalance = total >= wObj.amount;
                }
            } else {
                wObj.userTotalBalance = 0;
                wObj.hasEnoughBalance = wObj.isDeducted ? true : false;
            }
            return wObj;
        }));

        withdrawal.sort((a, b) => b._id.toString().localeCompare(a._id.toString()));

        res.render("admin/pages/dashboard", { users, categories, withdrawal, baseurl });
    }catch(err){
        console.log(err)
        res.status(500).send("Internal Server Error");
    }
})

// Helper to retrieve booked scrims for a user's squad
async function getUserScrims(user) {
    const scrims = [];
    if (!user || !user.team || (!user.team.teamName && !user.team._id)) {
        return scrims;
    }
    const orConditions = [];
    if (user.team.teamName) {
        orConditions.push({ "matches.teams.teamName": user.team.teamName });
    }
    if (user.team._id) {
        orConditions.push({ "matches.teams._id": user.team._id });
    }
    try {
        const categories = await categoryModel.find({ $or: orConditions });
        for (const cat of categories) {
            if (!cat.matches) continue;
            for (const m of cat.matches) {
                if (!m.teams) continue;
                const joinedTeam = m.teams.find(t => 
                    (user.team._id && t._id && t._id.toString() === user.team._id.toString()) ||
                    (user.team.teamName && t.teamName && t.teamName.toLowerCase() === user.team.teamName.toLowerCase())
                );
                if (joinedTeam) {
                    scrims.push({
                        categoryId: cat._id,
                        categoryTitle: cat.title,
                        matchId: m._id,
                        matchTitle: m.title,
                        date: m.date,
                        entryFee: m.entryFee || 0,
                        prizePool: m.prizePool || 0,
                        idpTimings: m.idpTimings || "",
                        teamStatus: joinedTeam.status || "registered",
                        joinedAt: joinedTeam._id ? joinedTeam._id.getTimestamp() : null
                    });
                }
            }
        }
    } catch (err) {
        console.error("Error fetching user scrims:", err);
    }
    scrims.sort((a, b) => {
        const timeA = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;
        const timeB = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;
        return timeB - timeA;
    });
    return scrims;
}

// 1. Admin Users List with Search & Pagination
app.get("/admin/users", adminAuthCheck, async (req, res) => {
    try {
        const search = req.query.search ? req.query.search.trim() : '';
        let filter = {};

        if (search) {
            const regex = new RegExp(search, 'i');
            const searchNum = Number(search);
            const orConditions = [
                { gglId: regex },
                { "team.teamName": regex },
                { "dropDetails.erangle": regex },
                { "dropDetails.rando": regex },
                { "dropDetails.miramar": regex }
            ];
            if (mongoose.Types.ObjectId.isValid(search)) {
                orConditions.push({ _id: new mongoose.Types.ObjectId(search) });
            }
            orConditions.push({
                $expr: {
                    $regexMatch: {
                        input: { $toString: "$_id" },
                        regex: regex
                    }
                }
            });
            if (!isNaN(searchNum) && search.length >= 3) {
                orConditions.push({ "team.whatsappNumber": searchNum });
            }
            filter.$or = orConditions;
        }

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = 25;
        const skip = (page - 1) * limit;

        const totalUsers = await userModel.countDocuments(filter);
        const totalPages = Math.ceil(totalUsers / limit) || 1;
        const users = await userModel.find(filter).sort({ _id: -1 }).skip(skip).limit(limit);

        const allUsersCount = await userModel.countDocuments();

        // Calculate total wallet balances across system
        const balanceAgg = await userModel.aggregate([
            {
                $group: {
                    _id: null,
                    totalAvailable: { $sum: { $ifNull: ["$wallet.balance.availableBalance", 0] } },
                    totalPrizePool: { $sum: { $ifNull: ["$wallet.balance.prizePool", 0] } }
                }
            }
        ]);

        const totalAvailable = balanceAgg[0]?.totalAvailable || 0;
        const totalPrizePool = balanceAgg[0]?.totalPrizePool || 0;
        const totalSystemBalance = totalAvailable + totalPrizePool;

        res.render("admin/pages/users", {
            users,
            page,
            totalPages,
            totalUsers,
            allUsersCount,
            totalAvailable,
            totalPrizePool,
            totalSystemBalance,
            search,
            baseurl
        });
    } catch (err) {
        console.error("Error fetching admin users:", err);
        res.status(500).send("Internal Server Error");
    }
});

// 2. Admin User Details JSON API (Used by Quick Modal)
app.get("/admin/api/user/:id", adminAuthCheck, async (req, res) => {
    try {
        const { id } = req.params;
        let user = null;
        if (mongoose.Types.ObjectId.isValid(id)) {
            user = await userModel.findById(id);
        }
        if (!user) {
            user = await userModel.findOne({ gglId: id });
        }
        if (!user) {
            return res.status(404).json({ success: false, msg: "User not found." });
        }

        const withdrawals = await withdrawalModel.find({ id: user.gglId }).sort({ _id: -1 });
        const deposits = await depositModel.find({ id: user.gglId }).sort({ date: -1, _id: -1 });
        const scrims = await getUserScrims(user);

        return res.status(200).json({
            success: true,
            user: {
                _id: user._id,
                gglId: user.gglId,
                team: user.team,
                wallet: user.wallet,
                dropDetails: user.dropDetails,
                createdAt: user._id ? user._id.getTimestamp() : null
            },
            withdrawals,
            deposits,
            scrims
        });
    } catch (err) {
        console.error("Error fetching user details API:", err);
        return res.status(500).json({ success: false, msg: "Internal server error." });
    }
});

// 3. Admin Dedicated User Detail Full Page
app.get("/admin/user/:id", adminAuthCheck, async (req, res) => {
    try {
        const { id } = req.params;
        let user = null;
        if (mongoose.Types.ObjectId.isValid(id)) {
            user = await userModel.findById(id);
        }
        if (!user) {
            user = await userModel.findOne({ gglId: id });
        }
        if (!user) {
            return res.status(404).send("User not found.");
        }

        const withdrawals = await withdrawalModel.find({ id: user.gglId }).sort({ _id: -1 });
        const deposits = await depositModel.find({ id: user.gglId }).sort({ date: -1, _id: -1 });
        const scrims = await getUserScrims(user);

        res.render("admin/pages/user-detail", {
            user,
            withdrawals,
            deposits,
            scrims,
            baseurl
        });
    } catch (err) {
        console.error("Error rendering user detail page:", err);
        res.status(500).send("Internal Server Error");
    }
});

// 4. Admin Edit User Wallet Endpoint
app.post("/admin/user/:id/edit-wallet", adminAuthCheck, async (req, res) => {
    try {
        const { id } = req.params;
        const { mode, availableBalance, prizePool } = req.body;

        let user = null;
        if (mongoose.Types.ObjectId.isValid(id)) {
            user = await userModel.findById(id);
        }
        if (!user) {
            user = await userModel.findOne({ gglId: id });
        }
        if (!user) {
            return res.status(404).json({ success: false, msg: "User not found." });
        }

        if (!user.wallet) {
            user.wallet = { balance: { availableBalance: 0, prizePool: 0 }, withdrawal: [] };
        }
        if (!user.wallet.balance) {
            user.wallet.balance = { availableBalance: 0, prizePool: 0 };
        }
        if (typeof user.wallet.balance.availableBalance === 'undefined') user.wallet.balance.availableBalance = 0;
        if (typeof user.wallet.balance.prizePool === 'undefined') user.wallet.balance.prizePool = 0;

        const newAvail = Number(availableBalance);
        const newPrize = Number(prizePool);

        if (isNaN(newAvail) || isNaN(newPrize)) {
            return res.status(400).json({ success: false, msg: "Invalid numeric balance entered." });
        }

        if (mode === "adjust") {
            user.wallet.balance.availableBalance += newAvail;
            user.wallet.balance.prizePool += newPrize;
        } else {
            user.wallet.balance.availableBalance = Math.max(0, newAvail);
            user.wallet.balance.prizePool = Math.max(0, newPrize);
        }

        if (user.wallet.balance.availableBalance < 0) user.wallet.balance.availableBalance = 0;
        if (user.wallet.balance.prizePool < 0) user.wallet.balance.prizePool = 0;

        await user.save();

        const totalBalance = user.wallet.balance.availableBalance + user.wallet.balance.prizePool;

        return res.status(200).json({
            success: true,
            msg: "Wallet updated successfully!",
            wallet: user.wallet.balance,
            totalBalance
        });
    } catch (err) {
        console.error("Error editing user wallet:", err);
        return res.status(500).json({ success: false, msg: "Internal server error." });
    }
});

app.get("/admin/categories", adminAuthCheck, async (req, res)=>{
    const categories = await categoryModel.find().sort({ order: 1, _id: 1 });
    res.render("admin/pages/categories", { categories, baseurl });
})

app.post("/admin/categories/reorder", adminAuthCheck, async (req, res) => {
    try {
        const { orderedIds } = req.body;
        if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
            return res.status(400).json({ success: false, msg: "Invalid category order data" });
        }

        const bulkOps = orderedIds.map((id, index) => ({
            updateOne: {
                filter: { _id: id },
                update: { $set: { order: index } }
            }
        }));

        await categoryModel.bulkWrite(bulkOps);
        return res.status(200).json({ success: true, msg: "Category order updated successfully" });
    } catch (err) {
        console.error("Error reordering categories:", err);
        return res.status(500).json({ success: false, msg: "Internal server error" });
    }
});

app.get("/admin/category/:id", adminAuthCheck, async (req, res)=>{
    try {
        const {id} = req.params;
        console.log(id);
        const getMatch = await categoryModel.find({_id:id}).select("matches -_id");
        if (!getMatch || getMatch.length === 0) {
            return res.status(404).send("Category not found");
        }
        const matches = getMatch[0].matches || [];
        if (matches.length > 0) {
            console.log(matches[0].date);
            if (matches[0].idpTimings) {
                console.log(matches[0].idpTimings.split(","));
            }
        }
        console.log(matches);
        res.render("admin/pages/category", { matches, id, baseurl });
    } catch (err) {
        console.error("Error fetching category matches:", err);
        res.status(500).send("Internal Server Error");
    }
    
})

app.get("/admin/addcategory", adminAuthCheck, (req, res)=>{
    res.render("admin/pages/addcategory", { baseurl });
})

app.post("/admin/addcategory", adminAuthCheck, upload.single('categoryPicture'), async (req, res)=>{
    try {
        console.log(req.body);
        console.log(req.file);
        const { title, description, teams, prizePool, entryFee } = req.body;
        if (!title || !description) {
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch(e) {}
            }
            return res.status(400).json({ msg: "Please fill all fields." });
        }
        const isExist = await categoryModel.findOne({ title: title });
        let msg;
        if(!isExist){
            let imgName = "";
            if (req.file) {
                const uploadResult = await uploadToCloudinary(req.file.path, 'categories');
                imgName = uploadResult.secure_url;
            }

            const maxCat = await categoryModel.findOne().sort({ order: -1 }).select("order");
            const nextOrder = (maxCat && typeof maxCat.order === 'number') ? maxCat.order + 1 : 0;

            const category = await categoryModel.create({
                title,
                description,
                teams: teams ? teams.trim() : "16-18",
                prizePool: prizePool ? prizePool.trim() : "1000",
                entryFee: entryFee ? entryFee.trim() : "60",
                order: nextOrder,
                img: imgName
            });
            const result = await category.save();
            if(result){
                 msg = "Category created successfully"
            } else {
                 msg = "Failed to create category."
            }
        } else {
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch(e) {}
            }
            msg = "Category already exist with this name."
        }
        
        res.json({msg});
    } catch (err) {
        console.error("Error creating category:", err);
        if (req.file && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch(e) {}
        }
        res.status(500).json({ msg: "Internal server error" });
    }
})

app.post("/admin/category/delete/:id", adminAuthCheck, async (req, res) => {
    try {
        const { id } = req.params;
        const category = await categoryModel.findById(id);
        if (!category) {
            return res.status(404).json({ success: false, msg: "Category not found." });
        }
        
        // Delete image if exists
        if (category.img) {
            if (category.img.startsWith("http://") || category.img.startsWith("https://")) {
                await deleteFromCloudinary(category.img);
            } else {
                const imgPath = path.join(__dirname, 'public', 'images', category.img);
                if (fs.existsSync(imgPath)) {
                    fs.unlinkSync(imgPath);
                }
            }
        }
        
        await categoryModel.findByIdAndDelete(id);
        return res.status(200).json({ success: true, msg: "Category deleted successfully" });
    } catch (err) {
        console.error("Error deleting category:", err);
        return res.status(500).json({ success: false, msg: "Internal server error" });
    }
})

app.get("/admin/editcategory/:id", adminAuthCheck, async (req, res)=>{
    try {
        const category = await categoryModel.findById(req.params.id);
        if(!category){
            return res.status(404).send("Category not found");
        }
        res.render("admin/pages/editcategory", { category, baseurl });
    } catch(err) {
        console.error(err);
        res.status(500).send("Internal Server Error");
    }
})

app.post("/admin/editcategory/:id", adminAuthCheck, upload.single('categoryPicture'), async (req, res)=>{
    try {
        const { title, description, teams, prizePool, entryFee } = req.body;
        if (!title || !description) {
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch(e) {}
            }
            return res.status(400).json({ msg: "Please fill all fields." });
        }
        
        const category = await categoryModel.findById(req.params.id);
        if (!category) {
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch(e) {}
            }
            return res.status(404).json({ msg: "Category not found." });
        }

        const oldTitle = category.title;

        // Check if another category with the same title already exists
        const isExist = await categoryModel.findOne({ title: title, _id: { $ne: req.params.id } });
        if (isExist) {
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch(e) {}
            }
            return res.status(400).json({ msg: "Category already exists with this name." });
        }

        category.title = title;
        category.description = description;
        if (teams !== undefined) category.teams = teams.trim() || "16-18";
        if (prizePool !== undefined) category.prizePool = prizePool.trim() || "1000";
        if (entryFee !== undefined) category.entryFee = entryFee.trim() || "60";

        if (req.file) {
            // Delete old image if it exists
            if (category.img) {
                if (category.img.startsWith("http://") || category.img.startsWith("https://")) {
                    await deleteFromCloudinary(category.img);
                } else {
                    const oldImgPath = path.join(__dirname, 'public', 'images', category.img);
                    if (fs.existsSync(oldImgPath)) {
                        fs.unlinkSync(oldImgPath);
                    }
                }
            }
            // Upload new image
            const uploadResult = await uploadToCloudinary(req.file.path, 'categories');
            category.img = uploadResult.secure_url;
        }

        await category.save();

        // Update PointTable documents if title changed
        if (oldTitle !== title) {
            await pointTableModel.updateMany(
                { categoryId: category._id },
                { categoryTitle: title }
            );
        }

        res.json({ msg: "Category updated successfully" });
    } catch (err) {
        console.error("Error updating category:", err);
        if (req.file && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch(e) {}
        }
        res.status(500).json({ msg: "Internal server error" });
    }
})

app.get("/admin/addscrim", adminAuthCheck, async (req, res)=>{
    const categories = await categoryModel.find().select("title -_id").sort({ order: 1, _id: 1 });
    console.log(categories);
    res.render("admin/pages/addscrim", { categories, baseurl });
})

app.post("/admin/addscrim", adminAuthCheck, async (req, res)=>{
    console.log(req.body);
    const match = req.body.data;
    
    const add = await categoryModel.findOneAndUpdate({title:req.body.category}, { $push:{matches:match}});
    console.log("adding scrim" + add);

    if(!add){
        res.json({msg:"Something went wrong, can't add scrim"});
    }

    res.json({msg:"Match added succesfully"});
})

app.post("/admin/category/:id/scrim/delete/:mid", adminAuthCheck, async (req, res) => {
    try {
        const { id, mid } = req.params;
        const result = await categoryModel.findByIdAndUpdate(
            id,
            { $pull: { matches: { _id: mid } } },
            { new: true }
        );
        if (result) {
            return res.status(200).json({ success: true, msg: "Scrim deleted successfully" });
        } else {
            return res.status(404).json({ success: false, msg: "Category or Scrim not found" });
        }
    } catch (err) {
        console.error("Error deleting scrim:", err);
        return res.status(500).json({ success: false, msg: "Internal server error" });
    }
})

app.post("/admin/category/:id/reorder-scrims", adminAuthCheck, async (req, res) => {
    try {
        const { id } = req.params;
        const { orderedIds } = req.body;

        if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
            return res.status(400).json({ success: false, msg: "Invalid match order data" });
        }

        const category = await categoryModel.findById(id);
        if (!category) {
            return res.status(404).json({ success: false, msg: "Category not found" });
        }

        const matchMap = new Map();
        category.matches.forEach(m => {
            matchMap.set(m._id.toString(), m);
        });

        if (orderedIds.length >= category.matches.length) {
            // Full reorder
            const newMatches = [];
            for (const mid of orderedIds) {
                if (matchMap.has(mid)) {
                    newMatches.push(matchMap.get(mid));
                    matchMap.delete(mid);
                }
            }
            for (const remaining of matchMap.values()) {
                newMatches.push(remaining);
            }
            category.matches = newMatches;
        } else {
            // Partial reorder (e.g. within a specific date filter)
            const positions = [];
            category.matches.forEach((m, idx) => {
                if (orderedIds.includes(m._id.toString())) {
                    positions.push(idx);
                }
            });

            let posIndex = 0;
            for (const mid of orderedIds) {
                if (matchMap.has(mid) && posIndex < positions.length) {
                    category.matches[positions[posIndex]] = matchMap.get(mid);
                    posIndex++;
                }
            }
        }

        await category.save();
        return res.status(200).json({ success: true, msg: "Match order updated successfully" });
    } catch (err) {
        console.error("Error reordering scrims:", err);
        return res.status(500).json({ success: false, msg: "Internal server error" });
    }
});

app.get("/admin/category/:id/scrim/edit/:mid", adminAuthCheck, async (req, res)=>{
    try {
        const { id, mid } = req.params;
        const category = await categoryModel.findById(id);
        if(!category){
            return res.status(404).send("Category not found");
        }
        const match = category.matches.id(mid);
        if(!match){
            return res.status(404).send("Scrim not found");
        }
        res.render("admin/pages/editscrim", { category, match, baseurl });
    } catch(err) {
        console.error(err);
        res.status(500).send("Internal Server Error");
    }
})

app.post("/admin/category/:id/scrim/edit/:mid", adminAuthCheck, async (req, res)=>{
    try {
        const { id, mid } = req.params;
        const matchData = req.body.data;
        
        const category = await categoryModel.findById(id);
        if(!category){
            return res.status(404).json({ msg: "Category not found" });
        }
        
        const match = category.matches.id(mid);
        if(!match){
            return res.status(404).json({ msg: "Scrim not found" });
        }

        const oldTitle = match.title;
        const newTitle = matchData.title;



        // Update match fields
        match.date = matchData.date;
        match.title = matchData.title;
        match.prizePool = Number(matchData.prizePool);
        match.slots = Number(matchData.slots);
        match.entryFee = Number(matchData.entryFee);
        match.idpTimings = matchData.idpTimings;
        match.maps = matchData.maps;
        match.details = matchData.details;
        match.whatsappGroupLink = matchData.whatsappGroupLink;

        await category.save();

        // Also update any PointTable entries referencing this matchTitle
        if (oldTitle !== newTitle) {
            await pointTableModel.updateMany(
                { categoryId: id, matchTitle: oldTitle },
                { matchTitle: newTitle }
            );
        }

        res.json({ msg: "Scrim updated successfully" });
    } catch(err) {
        console.error("Error updating scrim:", err);
        res.status(500).json({ msg: "Internal server error" });
    }
})

app.get("/admin/teams/:id/:mid", adminAuthCheck, async (req, res)=>{
    try {
        const {id, mid} = req.params;
        console.log(id)
        const category = await categoryModel.findOne({ _id: id, "matches._id": mid }, { "matches.$": 1, title: 1 });
        if (!category || !category.matches || category.matches.length === 0) {
            return res.status(404).send("Category or Match not found");
        }
        
        const match = category.matches[0];
        const matchesTeams = match.teams || [];
        
        // Fetch current logos and wallet details from the users collection for all these teams
        const teamNames = matchesTeams.map(t => t.teamName).filter(Boolean);
        const teamUserIds = matchesTeams.map(t => t.userId).filter(Boolean);
        const users = await userModel.find({
            $or: [
                { _id: { $in: teamUserIds } },
                { "team.teamName": { $in: teamNames } },
                { "teams.teamName": { $in: teamNames } }
            ]
        }).select("team teams wallet");
        
        // Create maps of teamName/userId -> logo, userId, and balance
        const logoMap = {};
        const userMap = {};
        const balanceMap = {};
        users.forEach(u => {
            const allUserTeams = (u.teams && u.teams.length > 0) ? u.teams : (u.team ? [u.team] : []);
            allUserTeams.forEach(tm => {
                if (tm && tm.teamName) {
                    const norm = tm.teamName.trim().toLowerCase();
                    logoMap[norm] = tm.teamLogo;
                    userMap[norm] = u._id.toString();
                    balanceMap[norm] = (u.wallet && u.wallet.balance && typeof u.wallet.balance.prizePool !== 'undefined') ? u.wallet.balance.prizePool : 0;
                }
            });
            userMap[u._id.toString()] = u._id.toString();
            balanceMap[u._id.toString()] = (u.wallet && u.wallet.balance && typeof u.wallet.balance.prizePool !== 'undefined') ? u.wallet.balance.prizePool : 0;
            if (u.team && u.team.teamLogo) {
                logoMap[u._id.toString()] = u.team.teamLogo;
            }
        });
        
        // Construct teams array with the latest logo, userId, and walletBalance
        const teams = matchesTeams.map(t => {
            const teamObj = t.toObject ? t.toObject() : t;
            const normName = t.teamName ? t.teamName.trim().toLowerCase() : "";
            const uid = (t.userId ? t.userId.toString() : "") || userMap[normName] || "";
            return {
                ...teamObj,
                userId: uid,
                walletBalance: (uid && typeof balanceMap[uid] !== 'undefined') ? balanceMap[uid] : (balanceMap[normName] || 0),
                teamLogo: (uid && logoMap[uid]) ? logoMap[uid] : (logoMap[normName] || t.teamLogo || ""),
                dropDetails: teamObj.dropDetails || {
                    erangle: teamObj.erangle || "",
                    rando: teamObj.rando || "",
                    miramar: teamObj.miramar || ""
                }
            };
        });

        console.log(teams);
        res.render("admin/pages/teams", { 
            teams, 
            categoryId: id, 
            matchId: mid, 
            matchTitle: match.title || "", 
            categoryTitle: category.title || "" 
        });
    } catch (err) {
        console.error("Error fetching teams:", err);
        res.status(500).send("Internal Server Error");
    }
})

app.post("/admin/user/:userId/update-wallet", adminAuthCheck, async (req, res) => {
    try {
        const { userId } = req.params;
        const { amount } = req.body;

        if (typeof amount !== 'number') {
            return res.status(400).json({ msg: "Invalid amount." });
        }

        const user = await userModel.findById(userId);
        if (!user) {
            return res.status(404).json({ msg: "User not found." });
        }

        // Initialize wallet structure if it doesn't exist
        if (!user.wallet) {
            user.wallet = { balance: { availableBalance: 0, prizePool: 0 }, withdrawal: [] };
        }
        if (!user.wallet.balance) {
            user.wallet.balance = { availableBalance: 0, prizePool: 0 };
        }
        if (typeof user.wallet.balance.prizePool === 'undefined') {
            user.wallet.balance.prizePool = 0;
        }

        user.wallet.balance.prizePool += amount;
        await user.save();

        return res.status(200).json({ msg: "Wallet updated successfully.", newBalance: user.wallet.balance.prizePool });
    } catch (err) {
        console.error("Error updating wallet balance:", err);
        return res.status(500).json({ msg: "Internal server error." });
    }
})

app.post("/admin/category/:id/match/:mid/team/:tid/status", adminAuthCheck, async (req, res) => {
    try {
        const { id, mid, tid } = req.params;
        const { status } = req.body;
        
        if (status !== "approved" && status !== "rejected") {
            return res.status(400).json({ msg: "Invalid status option." });
        }

        const category = await categoryModel.findOne({ _id: id });
        if (!category) {
            return res.status(404).json({ msg: "Category not found." });
        }

        const match = category.matches.id(mid);
        if (!match) {
            return res.status(404).json({ msg: "Match not found." });
        }

        const team = match.teams.id(tid);
        if (!team) {
            return res.status(404).json({ msg: "Team not found." });
        }

        if (status === "approved") {
            team.status = "approved";
            await category.save();
            return res.status(200).json({ msg: "Team approved successfully." });
        } else if (status === "rejected") {
            if (team.paymentScreenshot) {
                const screenshotPath = path.join(__dirname, 'public', 'images', team.paymentScreenshot);
                if (fs.existsSync(screenshotPath)) {
                    try { fs.unlinkSync(screenshotPath); } catch(e) {}
                }
            }
            match.teams.pull(tid);
            await category.save();
            return res.status(200).json({ msg: "Team removed successfully." });
        }
    } catch (err) {
        console.error("Error processing team status:", err);
        return res.status(500).json({ msg: "Internal server error." });
    }
});

app.post("/admin/category/:id/match/:mid/team/:tid/delete", adminAuthCheck, async (req, res) => {
    try {
        const { id, mid, tid } = req.params;

        const category = await categoryModel.findOne({ _id: id });
        if (!category) {
            return res.status(404).json({ msg: "Category not found." });
        }

        const match = category.matches.id(mid);
        if (!match) {
            return res.status(404).json({ msg: "Match not found." });
        }

        const team = match.teams.id(tid);
        if (!team) {
            return res.status(404).json({ msg: "Team not found." });
        }

        if (team.paymentScreenshot) {
            const screenshotPath = path.join(__dirname, 'public', 'images', team.paymentScreenshot);
            if (fs.existsSync(screenshotPath)) {
                try { fs.unlinkSync(screenshotPath); } catch(e) {}
            }
        }

        match.teams.pull(tid);
        await category.save();

        return res.status(200).json({ msg: "Team deleted successfully." });
    } catch (err) {
        console.error("Error deleting team:", err);
        return res.status(500).json({ msg: "Internal server error." });
    }
});

app.post("/admin/category/:id/match/:mid/team/:tid/match-details", adminAuthCheck, async (req, res) => {
    try {
        const { id, mid, tid } = req.params;
        const { rank, finishes, matches } = req.body;

        const category = await categoryModel.findOne({ _id: id });
        if (!category) {
            return res.status(404).json({ msg: "Category not found." });
        }

        const match = category.matches.id(mid);
        if (!match) {
            return res.status(404).json({ msg: "Match not found." });
        }

        const team = match.teams.id(tid);
        if (!team) {
            return res.status(404).json({ msg: "Team not found." });
        }

        let matchScores = [];
        let totalPlacementPoints = 0;
        let totalFinishes = 0;
        let totalFinishPoints = 0;
        let totalPoints = 0;

        if (Array.isArray(matches) && matches.length > 0) {
            matches.forEach((m, idx) => {
                const r = (m.rank !== null && typeof m.rank !== 'undefined' && m.rank !== '') ? Number(m.rank) : null;
                const f = Math.max(0, Number(m.finishes) || 0);
                const pPts = r ? calculatePlacementPoints(r) : 0;
                const fPts = f * 1;
                const tPts = pPts + fPts;

                totalPlacementPoints += pPts;
                totalFinishes += f;
                totalFinishPoints += fPts;
                totalPoints += tPts;

                matchScores.push({
                    matchNumber: idx + 1,
                    rank: r,
                    finishes: f,
                    placementPoints: pPts,
                    finishPoints: fPts,
                    totalPoints: tPts
                });
            });
        } else {
            const r = (rank !== null && typeof rank !== 'undefined' && rank !== '') ? Number(rank) : null;
            const f = Math.max(0, Number(finishes) || 0);
            const pPts = r ? calculatePlacementPoints(r) : 0;
            const fPts = f * 1;
            const tPts = pPts + fPts;

            totalPlacementPoints = pPts;
            totalFinishes = f;
            totalFinishPoints = fPts;
            totalPoints = tPts;

            matchScores.push({
                matchNumber: 1,
                rank: r,
                finishes: f,
                placementPoints: pPts,
                finishPoints: fPts,
                totalPoints: tPts
            });
        }

        team.matchScores = matchScores;
        team.rank = matchScores.length > 0 ? matchScores[0].rank : null;
        team.finishes = totalFinishes;
        team.placementPoints = totalPlacementPoints;
        team.finishPoints = totalFinishPoints;
        team.totalPoints = totalPoints;

        await category.save();

        if (team.teamName) {
            await syncTeamStats(team.teamName);
        }

        return res.status(200).json({
            msg: "Match details saved successfully!",
            matchScores,
            totalPoints,
            totalFinishes,
            placementPoints: totalPlacementPoints,
            finishPoints: totalFinishPoints
        });
    } catch (err) {
        console.error("Error saving scrim match details:", err);
        return res.status(500).json({ msg: "Internal server error." });
    }
});

/* Admin Tournament Routes */

app.get("/admin/tournaments", adminAuthCheck, async (req, res) => {
    try {
        const tournaments = await tournamentModel.find().sort({ createdAt: -1 });
        res.render("admin/pages/tournaments", { tournaments, baseurl });
    } catch (err) {
        console.error("Error fetching tournaments:", err);
        res.status(500).send("Internal Server Error");
    }
});

app.get("/admin/addtournament", adminAuthCheck, (req, res) => {
    res.render("admin/pages/addtournament", { baseurl });
});

app.post("/admin/addtournament", adminAuthCheck, async (req, res) => {
    try {
        const { title, date, slots, entryFee, prizePool, idpTimings, maps, details, whatsappGroupLink } = req.body;
        
        if (!title || !date) {
            return res.status(400).json({ msg: "Title and Date are required." });
        }

        const newTournament = new tournamentModel({
            title,
            date,
            slots: Number(slots) || 20,
            entryFee: Number(entryFee) || 0,
            prizePool: Number(prizePool) || 0,
            idpTimings: idpTimings || "",
            maps: maps || "",
            details: details || "",
            whatsappGroupLink: whatsappGroupLink || "",
            teams: []
        });

        await newTournament.save();
        res.status(200).json({ msg: "Tournament added successfully!" });
    } catch (err) {
        console.error("Error adding tournament:", err);
        res.status(500).json({ msg: "Internal server error while adding tournament." });
    }
});

app.get("/admin/edittournament/:id", adminAuthCheck, async (req, res) => {
    try {
        const { id } = req.params;
        const tournament = await tournamentModel.findById(id);
        if (!tournament) {
            return res.status(404).send("Tournament not found");
        }
        res.render("admin/pages/edittournament", { tournament, baseurl });
    } catch (err) {
        console.error("Error fetching tournament for edit:", err);
        res.status(500).send("Internal Server Error");
    }
});

app.post("/admin/edittournament/:id", adminAuthCheck, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, date, slots, entryFee, prizePool, idpTimings, maps, details, whatsappGroupLink } = req.body;

        const updated = await tournamentModel.findByIdAndUpdate(
            id,
            {
                title,
                date,
                slots: Number(slots) || 20,
                entryFee: Number(entryFee) || 0,
                prizePool: Number(prizePool) || 0,
                idpTimings: idpTimings || "",
                maps: maps || "",
                details: details || "",
                whatsappGroupLink: whatsappGroupLink || ""
            },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ msg: "Tournament not found" });
        }

        res.status(200).json({ msg: "Tournament updated successfully!" });
    } catch (err) {
        console.error("Error updating tournament:", err);
        res.status(500).json({ msg: "Internal server error while updating tournament." });
    }
});

app.post("/admin/tournament/delete/:id", adminAuthCheck, async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await tournamentModel.findByIdAndDelete(id);
        if (!deleted) {
            return res.status(404).json({ msg: "Tournament not found." });
        }
        res.status(200).json({ msg: "Tournament deleted successfully!" });
    } catch (err) {
        console.error("Error deleting tournament:", err);
        res.status(500).json({ msg: "Internal server error while deleting tournament." });
    }
});

app.get("/admin/tournament/:id/teams", adminAuthCheck, async (req, res) => {
    try {
        const { id } = req.params;
        const tournament = await tournamentModel.findById(id);
        if (!tournament) {
            return res.status(404).send("Tournament not found");
        }

        const tournamentTeams = tournament.teams || [];
        const teamNames = tournamentTeams.map(t => t.teamName).filter(Boolean);
        const teamUserIds = tournamentTeams.map(t => t.userId).filter(Boolean);
        const users = await userModel.find({
            $or: [
                { _id: { $in: teamUserIds } },
                { "team.teamName": { $in: teamNames } },
                { "teams.teamName": { $in: teamNames } }
            ]
        }).select("team teams wallet");

        const logoMap = {};
        const userMap = {};
        const balanceMap = {};
        users.forEach(u => {
            const allUserTeams = (u.teams && u.teams.length > 0) ? u.teams : (u.team ? [u.team] : []);
            allUserTeams.forEach(tm => {
                if (tm && tm.teamName) {
                    const norm = tm.teamName.trim().toLowerCase();
                    logoMap[norm] = tm.teamLogo;
                    userMap[norm] = u._id.toString();
                    balanceMap[norm] = (u.wallet && u.wallet.balance && typeof u.wallet.balance.prizePool !== 'undefined') ? u.wallet.balance.prizePool : 0;
                }
            });
            userMap[u._id.toString()] = u._id.toString();
            balanceMap[u._id.toString()] = (u.wallet && u.wallet.balance && typeof u.wallet.balance.prizePool !== 'undefined') ? u.wallet.balance.prizePool : 0;
            if (u.team && u.team.teamLogo) {
                logoMap[u._id.toString()] = u.team.teamLogo;
            }
        });

        const teams = tournamentTeams.map(t => {
            const teamObj = t.toObject ? t.toObject() : t;
            const normName = t.teamName ? t.teamName.trim().toLowerCase() : "";
            const uid = (t.userId ? t.userId.toString() : "") || userMap[normName] || "";
            return {
                ...teamObj,
                userId: uid,
                walletBalance: (uid && typeof balanceMap[uid] !== 'undefined') ? balanceMap[uid] : (balanceMap[normName] || 0),
                teamLogo: (uid && logoMap[uid]) ? logoMap[uid] : (logoMap[normName] || t.teamLogo || ""),
                dropDetails: teamObj.dropDetails || {
                    erangle: teamObj.erangle || "",
                    rando: teamObj.rando || "",
                    miramar: teamObj.miramar || ""
                }
            };
        });

        res.render("admin/pages/tournamentTeams", { 
            tournament: { ...tournament.toObject(), teams }, 
            baseurl 
        });
    } catch (err) {
        console.error("Error fetching tournament teams:", err);
        res.status(500).send("Internal Server Error");
    }
});

app.post("/admin/tournament/:tournamentId/team/:teamId/delete", adminAuthCheck, async (req, res) => {
    try {
        const { tournamentId, teamId } = req.params;
        const tournament = await tournamentModel.findById(tournamentId);
        if (!tournament) {
            return res.status(404).json({ msg: "Tournament not found." });
        }

        const team = tournament.teams.id(teamId);
        if (!team) {
            return res.status(404).json({ msg: "Team not found." });
        }

        tournament.teams.pull(teamId);
        await tournament.save();

        return res.status(200).json({ msg: "Team deleted successfully." });
    } catch (err) {
        console.error("Error deleting tournament team:", err);
        return res.status(500).json({ msg: "Internal server error." });
    }
});

app.post("/admin/tournament/:tournamentId/team/:teamId/match-details", adminAuthCheck, async (req, res) => {
    try {
        const { tournamentId, teamId } = req.params;
        const { rank, finishes, matches } = req.body;

        const tournament = await tournamentModel.findById(tournamentId);
        if (!tournament) {
            return res.status(404).json({ msg: "Tournament not found." });
        }

        const team = tournament.teams.id(teamId);
        if (!team) {
            return res.status(404).json({ msg: "Team not found." });
        }

        let matchScores = [];
        let totalPlacementPoints = 0;
        let totalFinishes = 0;
        let totalFinishPoints = 0;
        let totalPoints = 0;

        if (Array.isArray(matches) && matches.length > 0) {
            matches.forEach((m, idx) => {
                const r = (m.rank !== null && typeof m.rank !== 'undefined' && m.rank !== '') ? Number(m.rank) : null;
                const f = Math.max(0, Number(m.finishes) || 0);
                const pPts = r ? calculatePlacementPoints(r) : 0;
                const fPts = f * 1;
                const tPts = pPts + fPts;

                totalPlacementPoints += pPts;
                totalFinishes += f;
                totalFinishPoints += fPts;
                totalPoints += tPts;

                matchScores.push({
                    matchNumber: idx + 1,
                    rank: r,
                    finishes: f,
                    placementPoints: pPts,
                    finishPoints: fPts,
                    totalPoints: tPts
                });
            });
        } else {
            const r = (rank !== null && typeof rank !== 'undefined' && rank !== '') ? Number(rank) : null;
            const f = Math.max(0, Number(finishes) || 0);
            const pPts = r ? calculatePlacementPoints(r) : 0;
            const fPts = f * 1;
            const tPts = pPts + fPts;

            totalPlacementPoints = pPts;
            totalFinishes = f;
            totalFinishPoints = fPts;
            totalPoints = tPts;

            matchScores.push({
                matchNumber: 1,
                rank: r,
                finishes: f,
                placementPoints: pPts,
                finishPoints: fPts,
                totalPoints: tPts
            });
        }

        team.matchScores = matchScores;
        team.rank = matchScores.length > 0 ? matchScores[0].rank : null;
        team.finishes = totalFinishes;
        team.placementPoints = totalPlacementPoints;
        team.finishPoints = totalFinishPoints;
        team.totalPoints = totalPoints;

        await tournament.save();

        if (team.teamName) {
            await syncTeamStats(team.teamName);
        }

        return res.status(200).json({
            msg: "Tournament match details saved successfully!",
            matchScores,
            totalPoints,
            totalFinishes,
            placementPoints: totalPlacementPoints,
            finishPoints: totalFinishPoints
        });
    } catch (err) {
        console.error("Error saving tournament match details:", err);
        return res.status(500).json({ msg: "Internal server error." });
    }
});

app.get("/admin/withdrawals", adminAuthCheck, async (req, res)=>{
    try {
        const rawWithdrawals = await withdrawalModel.find();
        
        // Map to plain objects and fetch user balance for each withdrawal request
        const withdrawals = await Promise.all(rawWithdrawals.map(async (w) => {
            const wObj = w.toObject();
            
            // Find user to check balance
            const user = await userModel.findOne({ gglId: wObj.id });
            if (user) {
                const available = (user.wallet && user.wallet.balance && typeof user.wallet.balance.availableBalance !== 'undefined') ? Number(user.wallet.balance.availableBalance) : 0;
                const prize = (user.wallet && user.wallet.balance && typeof user.wallet.balance.prizePool !== 'undefined') ? Number(user.wallet.balance.prizePool) : 0;
                const total = available + prize;
                
                wObj.userTotalBalance = total;
                if (wObj.isDeducted) {
                    wObj.hasEnoughBalance = true;
                } else {
                    wObj.hasEnoughBalance = total >= wObj.amount;
                }
            } else {
                wObj.userTotalBalance = 0;
                wObj.hasEnoughBalance = wObj.isDeducted ? true : false;
            }
            return wObj;
        }));

        // Sort in-memory: pending first, then by latest request on top
        withdrawals.sort((a, b) => {
            if (a.status === 'pending' && b.status !== 'pending') return -1;
            if (a.status !== 'pending' && b.status === 'pending') return 1;
            return b._id.toString().localeCompare(a._id.toString());
        });

        res.render("admin/pages/withdrawals", { withdrawals, baseurl });
    } catch (err) {
        console.error("Error fetching withdrawals for admin:", err);
        res.status(500).send("Internal Server Error");
    }
})

app.post("/admin/withdrawalReq", adminAuthCheck, async (req, res)=>{
    try {
        const { option, id } = req.body;
        
        // Find the request and verify it is still pending
        const withdrawalReq = await withdrawalModel.findOne({ _id: id });
        if (!withdrawalReq) {
            return res.status(404).json({ msg: "Withdrawal request not found." });
        }
        
        if (withdrawalReq.status !== "pending") {
            return res.status(400).json({ msg: "This withdrawal request has already been processed." });
        }

        if (option === "rejected") {
            // Revert / refund deduction if it was immediately deducted
            if (withdrawalReq.isDeducted) {
                const user = await userModel.findOne({ gglId: withdrawalReq.id });
                if (user) {
                    // Initialize structure to be safe
                    if (!user.wallet) user.wallet = {};
                    if (!user.wallet.balance) user.wallet.balance = { availableBalance: 0, prizePool: 0 };
                    if (typeof user.wallet.balance.availableBalance === 'undefined') user.wallet.balance.availableBalance = 0;
                    if (typeof user.wallet.balance.prizePool === 'undefined') user.wallet.balance.prizePool = 0;

                    user.wallet.balance.prizePool += Number(withdrawalReq.prizePoolDeducted || 0);
                    user.wallet.balance.availableBalance += Number(withdrawalReq.availableBalanceDeducted || 0);
                    await user.save();
                }
            }

            // Update status to rejected
            withdrawalReq.status = "rejected";
            await withdrawalReq.save();
            
            return res.status(200).json({ msg: "Withdrawal request rejected successfully." });
        } else if (option === "approved") {
            // If it was NOT already deducted (legacy pending request), deduct it now
            if (!withdrawalReq.isDeducted) {
                // Find the user to deduct the amount
                const user = await userModel.findOne({ gglId: withdrawalReq.id });
                if (!user) {
                    return res.status(404).json({ msg: "User not found." });
                }

                const availableBalance = (user.wallet && user.wallet.balance && typeof user.wallet.balance.availableBalance !== 'undefined') ? Number(user.wallet.balance.availableBalance) : 0;
                const prizePool = (user.wallet && user.wallet.balance && typeof user.wallet.balance.prizePool !== 'undefined') ? Number(user.wallet.balance.prizePool) : 0;
                const totalBalance = availableBalance + prizePool;

                if (totalBalance < withdrawalReq.amount) {
                    return res.status(400).json({ msg: "User does not have sufficient balance. Current Total: ₹" + totalBalance });
                }

                // Initialize structure to be safe
                if (!user.wallet) user.wallet = {};
                if (!user.wallet.balance) user.wallet.balance = { availableBalance: 0, prizePool: 0 };
                if (typeof user.wallet.balance.availableBalance === 'undefined') user.wallet.balance.availableBalance = 0;
                if (typeof user.wallet.balance.prizePool === 'undefined') user.wallet.balance.prizePool = 0;

                // Deduct split logic: First from prizePool, then remaining from availableBalance
                if (prizePool >= withdrawalReq.amount) {
                    user.wallet.balance.prizePool -= withdrawalReq.amount;
                } else {
                    const remaining = withdrawalReq.amount - prizePool;
                    user.wallet.balance.prizePool = 0;
                    user.wallet.balance.availableBalance -= remaining;
                }

                await user.save();
            }

            // Update status to approved
            withdrawalReq.status = "approved";
            await withdrawalReq.save();
            
            return res.status(200).json({ msg: "Withdrawal approved successfully." });
        } else {
            return res.status(400).json({ msg: "Invalid status option." });
        }
    } catch (err) {
        console.error("Admin withdrawal processing error:", err);
        return res.status(500).json({ msg: "Internal server error." });
    }
})

app.get("/admin/transactions", adminAuthCheck, async (req, res)=>{
    try {
        const transactions = await depositModel.find().sort({ date: -1 });
        res.render("admin/pages/transactions", { transactions, baseurl });
    } catch(err) {
        console.error("Error fetching admin transactions:", err);
        res.status(500).send("Internal Server Error");
    }
});

app.post("/admin/transactionReq", adminAuthCheck, async (req, res)=>{
    try {
        const { option, id } = req.body;
        
        // Find the transaction request and verify it is still pending
        const depositReq = await depositModel.findOne({ _id: id });
        if (!depositReq) {
            return res.status(404).json({ msg: "Transaction request not found." });
        }
        
        if (depositReq.status !== "pending") {
            return res.status(400).json({ msg: "This transaction request has already been processed." });
        }

        if (option === "rejected") {
            // Update status to rejected
            depositReq.status = "rejected";
            await depositReq.save();
            
            return res.status(200).json({ msg: "Transaction request rejected successfully." });
        } else if (option === "approved") {
            // Update status to approved
            depositReq.status = "approved";
            await depositReq.save();
            
            // Add the balance to the user's wallet availableBalance
            const updatedUser = await userModel.findOneAndUpdate(
                { gglId: depositReq.id },
                { $inc: { "wallet.balance.availableBalance": depositReq.amount } },
                { new: true }
            );

            if (!updatedUser) {
                // If user not found, roll back approval status
                depositReq.status = "pending";
                await depositReq.save();
                return res.status(404).json({ msg: "User associated with this transaction was not found. Request rolled back to pending." });
            }
            
            return res.status(200).json({ msg: "Transaction approved and funds added to user's wallet successfully." });
        } else {
            return res.status(400).json({ msg: "Invalid status option." });
        }
    } catch (err) {
        console.error("Admin transaction processing error:", err);
        return res.status(500).json({ msg: "Internal server error." });
    }
});

app.get("/admin/point-table", adminAuthCheck, async (req, res)=>{
    try {
        const pointTables = await pointTableModel.find().sort({ _id: -1 });
        res.render("admin/pages/pointtable", { pointTables, baseurl });
    } catch (err) {
        console.error("Error fetching point tables:", err);
        res.status(500).send("Internal Server Error");
    }
});

app.get("/admin/add-point-table", adminAuthCheck, async (req, res)=>{
    try {
        const categories = await categoryModel.find().sort({ order: 1, _id: 1 });

        const now = new Date();
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const istTodayStr = new Intl.DateTimeFormat('en-CA', { 
            timeZone: 'Asia/Kolkata', 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit' 
        }).format(now);

        const filteredCategories = categories.map(cat => {
            const catObj = cat.toObject ? cat.toObject() : JSON.parse(JSON.stringify(cat));
            catObj.matches = (catObj.matches || []).filter(match => {
                let isRecent = false;
                if (match._id) {
                    try {
                        const createdAt = typeof match._id.getTimestamp === 'function' 
                            ? match._id.getTimestamp() 
                            : new mongoose.Types.ObjectId(match._id).getTimestamp();
                        if (createdAt && createdAt >= twentyFourHoursAgo) {
                            isRecent = true;
                        }
                    } catch (e) {}
                }
                if (!isRecent && match.date) {
                    if (match.date >= istTodayStr) {
                        isRecent = true;
                    }
                }
                return isRecent;
            });
            return catObj;
        }).filter(cat => cat.matches && cat.matches.length > 0);

        res.render("admin/pages/addpointtable", { categories: filteredCategories, baseurl });
    } catch (err) {
        console.error("Error rendering add point table:", err);
        res.status(500).send("Internal Server Error");
    }
});

app.post("/admin/add-point-table", adminAuthCheck, upload.single('pointTableImage'), async (req, res)=>{
    try {
        const { categoryId, categoryTitle, matchTitle, date } = req.body;
        if (!categoryId || !categoryTitle || !matchTitle || !date || !req.file) {
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch (e) {}
            }
            return res.status(400).json({ msg: "Please fill all fields and upload an image." });
        }

        // Upload new image to Cloudinary
        const uploadResult = await uploadToCloudinary(req.file.path, 'point_tables');
        const imageUrl = uploadResult.secure_url;

        // Create a new point table entry (prevent replacement of existing tables with the same category and match title)
        const newTable = new pointTableModel({
            categoryId,
            categoryTitle,
            matchTitle,
            date,
            pointTableImage: imageUrl
        });
        await newTable.save();

        return res.status(200).json({ msg: "Point table submitted successfully.", success: true });
    } catch (err) {
        console.error("Error creating/updating point table:", err);
        if (req.file && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
        return res.status(500).json({ msg: "Internal server error." });
    }
});

app.post("/admin/point-table/delete/:id", adminAuthCheck, async (req, res)=>{
    try {
        const { id } = req.params;
        const pt = await pointTableModel.findById(id);
        if (!pt) {
            return res.status(404).json({ msg: "Point table not found." });
        }

        // Delete the image file
        const imagePath = pt.pointTableImage;
        if (imagePath) {
            if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
                await deleteFromCloudinary(imagePath);
            } else {
                const oldLocalPath = path.join(__dirname, 'public', 'images', imagePath);
                if (fs.existsSync(oldLocalPath)) {
                    try { fs.unlinkSync(oldLocalPath); } catch (e) { console.error("Error deleting point table image file:", e); }
                }
            }
        }

        await pointTableModel.findByIdAndDelete(id);
        return res.status(200).json({ msg: "Point table deleted successfully.", success: true });
    } catch (err) {
        console.error("Error deleting point table:", err);
        return res.status(500).json({ msg: "Internal server error." });
    }
});

app.get("/admin/add-point-table-cover", adminAuthCheck, (req, res)=>{
    res.render("admin/pages/addpointtablecover", { baseurl });
});

app.post("/admin/add-point-table-cover", adminAuthCheck, upload.single('coverImage'), async (req, res)=>{
    try {
        if (!req.file) {
            return res.status(400).json({ msg: "Please select an image file to upload." });
        }

        // Upload new cover image to Cloudinary
        const uploadResult = await uploadToCloudinary(req.file.path, 'covers');
        const imageUrl = uploadResult.secure_url;

        const existingCover = await pointTableCoverModel.findOne();
        if (existingCover) {
            // Delete old image file
            const oldPath = existingCover.image;
            if (oldPath) {
                if (oldPath.startsWith("http://") || oldPath.startsWith("https://")) {
                    await deleteFromCloudinary(oldPath);
                } else {
                    const oldLocalPath = path.join(__dirname, 'public', 'images', oldPath);
                    if (fs.existsSync(oldLocalPath)) {
                        try { fs.unlinkSync(oldLocalPath); } catch (e) { console.error("Error deleting old cover image:", e); }
                    }
                }
            }
            existingCover.image = imageUrl;
            await existingCover.save();
        } else {
            const newCover = new pointTableCoverModel({
                image: imageUrl
            });
            await newCover.save();
        }

        return res.status(200).json({ msg: "Cover image uploaded successfully.", success: true });
    } catch (err) {
        console.error("Error uploading point table cover:", err);
        if (req.file && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
        return res.status(500).json({ msg: "Internal server error." });
    }
});

app.get("/admin/login", (req, res)=>{
    console.log(baseurl);
    res.render("admin/pages/login", {baseurl});
})

app.post("/admin/login", async (req, res)=>{
    try{
        const { email, password } = req.body;
    if(!email || !password){
        return res.status(400).json({msg:"Please enter both fields."})
    }

    const getCredientials = await adminModel.find();
    const verify = await bcrypt.compare(password, getCredientials[0].password);
    if(!verify){
       return res.status(401).json({msg:'Invalid credientials'});
    };

    req.session.userId = getCredientials[0]._id.toString();
    res.json({status:true, msg:"Login successfull"})
  }catch(err){
    console.log(err);
  }
})

app.get("/admin/signin", (req, res)=>{
    res.render("admin/pages/signin", {baseurl});
})

app.post("/admin/signin", async (req, res)=>{
    try{
        const { email, password } = req.body;
    if(!email || !password){
        return res.status(400).json({msg:"Please enter both fields."})
    }

    const get = await adminModel.find();
    if(get.length >= 1){
        return res.json({msg:"Admin account already Exist please Login to Your Admin panel."})
    }
    const hashedpass = await bcrypt.hash(password, 10);
    console.log(hashedpass);

    const saveCre = await adminModel.create({email:email, password:hashedpass});
    const check = await saveCre.save();
    
    if(!check){
        return res.json({msg:"Something went wrong in Signing in"})
    }

    return res.json({status:true, msg:"Sign In successfull."});
    
  }catch(err){
    console.log(err);
  }
});

app.get("/admin/logout", (req, res)=>{
  req.session.destroy((err)=>{
    if(err){
        return res.status(500).json({msg:"Logout failed"})
    }

    res.clearCookie("connect.sid");

    res.redirect("/admin/login")
  })
})

const port = process.env.PORT || 3000;

app.listen(port, ()=>{
    console.log(`Server is listening on ${port}`);
})
