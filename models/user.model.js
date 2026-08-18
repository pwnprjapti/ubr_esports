import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    gglId:{type:String},
    team:{teamName:{type:String}, teamLogo:{type:String}, whatsappNumber:{type:Number}},
    wallet:{
        balance:{
            availableBalance:{type:Number},
            prizePool:{type:Number}
        },
        withdrawal:[{date:{String}, amount:{Number}, method:{type:String}, status:{type:String}, remark:{type:String}}]
    },
    dropDetails:{
        erangle:{type:String, default:""},
        rando:{type:String, default:""},
        miramar:{type:String, default:""}
    }
});

const userModel = mongoose.model("user", userSchema);

export default userModel;