import mongoose from "mongoose";

const categorySchema = new mongoose.Schema({
    title:{type:String},
    description:{type:String},
    img:{type:String},
    teams:{type:String, default:"16-18"},
    prizePool:{type:String, default:"1000"},
    entryFee:{type:String, default:"60"},
    order:{type:Number, default:0},
    matches:[
        {
            date:{type:String},
            title:{type:String},
            prizePool:{type:Number},
            slots:{type:Number},
            entryFee:{type:Number},
            idpTimings:{type:String},
            maps:{type:String},
            details:{type:String},
            whatsappGroupLink:{type:String},
            teams:[
                {
                    teamId:{type:mongoose.Schema.Types.ObjectId},
                    userId:{type:mongoose.Schema.Types.ObjectId, ref:"user"},
                    teamName:{type:String},
                    teamLogo:{type:String},
                    whatsappNumber:{type:Number},
                    erangle:{type:String},
                    rando:{type:String},
                    miramar:{type:String},
                    dropDetails:{
                        erangle:{type:String},
                        rando:{type:String},
                        miramar:{type:String}
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
                    ]
                }
            ]
        }
    ]
});

const categoryModel = mongoose.model("Categories", categorySchema);

export default categoryModel;