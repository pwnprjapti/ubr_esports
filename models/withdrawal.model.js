import mongoose from "mongoose";

const withdrawalSchema = new mongoose.Schema({
    playerName:{type:String},
    id:{type:String},
    amount:{type:Number},
    payoutMethod:{type:String},
    payoutDetail:{type:String},
    status:{type:String},
    note:{type:String},
    prizePoolDeducted:{type:Number, default:0},
    availableBalanceDeducted:{type:Number, default:0},
    isDeducted:{type:Boolean, default:false}
})

const withdrawalModel = mongoose.model("withdrawalRequest", withdrawalSchema);

export default withdrawalModel;