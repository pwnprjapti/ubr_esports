import mongoose from "mongoose";

const referralSchema = new mongoose.Schema({
    referrer: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "user", 
        required: true, 
        index: true 
    },
    referee: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "user", 
        required: true, 
        unique: true, 
        index: true 
    },
    referralCode: { 
        type: String, 
        required: true, 
        uppercase: true, 
        trim: true 
    },
    status: { 
        type: String, 
        enum: ["pending", "completed"], 
        default: "pending", 
        index: true 
    },
    rewardAmount: { 
        type: Number, 
        default: 10 
    },
    rewardedAt: { 
        type: Date, 
        default: null 
    },
    firstMatchId: { 
        type: String, 
        default: "" 
    },
    firstMatchType: { 
        type: String, 
        default: "" // "scrim" or "tournament"
    }
}, { timestamps: true });

const referralModel = mongoose.model("Referral", referralSchema);

export default referralModel;
