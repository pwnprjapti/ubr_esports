import mongoose from "mongoose";

const tournamentSchema = new mongoose.Schema({
    title: { type: String, required: true },
    date: { type: String, required: true },
    prizePool: { type: Number, default: 0 },
    slots: { type: Number, default: 20 },
    entryFee: { type: Number, default: 0 },
    idpTimings: { type: String, default: "" },
    maps: { type: String, default: "" },
    details: { type: String, default: "" },
    whatsappGroupLink: { type: String, default: "" },
    banner: { type: String, default: "" },
    status: { type: String, enum: ["upcoming", "ongoing", "completed"], default: "upcoming" },
    teams: [
        {
            teamId: { type: mongoose.Schema.Types.ObjectId },
            userId: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
            teamName: { type: String },
            teamLogo: { type: String },
            whatsappNumber: { type: Number },
            erangle: { type: String },
            rando: { type: String },
            miramar: { type: String },
            dropDetails: {
                erangle: { type: String },
                rando: { type: String },
                miramar: { type: String }
            },
            rank: { type: Number, default: null },
            finishes: { type: Number, default: 0 },
            placementPoints: { type: Number, default: 0 },
            finishPoints: { type: Number, default: 0 },
            totalPoints: { type: Number, default: 0 },
            matchScores: [
                {
                    matchNumber: { type: Number },
                    rank: { type: Number, default: null },
                    finishes: { type: Number, default: 0 },
                    placementPoints: { type: Number, default: 0 },
                    finishPoints: { type: Number, default: 0 },
                    totalPoints: { type: Number, default: 0 }
                }
            ],
            joinedAt: { type: Date, default: Date.now }
        }
    ],
    createdAt: { type: Date, default: Date.now }
});

const tournamentModel = mongoose.model("Tournaments", tournamentSchema);

export default tournamentModel;
