import mongoose from "mongoose";

const withdrawalSchema = new mongoose.Schema({
    playerName:{type:String},
    id:{type:String},
    amount:{type:Number},
    payoutMethod:{type:String},
    payoutDetail:{type:String},
    note:{type:String},
    status:{type:String},
    note:{type:String}
})

const withdrawalModel = mongoose.model("withdrawalRequest", withdrawalSchema);

export default withdrawalModel;