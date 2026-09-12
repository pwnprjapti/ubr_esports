import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    gglId:{type:String, index:true, unique:true, sparse:true},
    team:{
        _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() }, 
        teamName:{type:String, index:true}, 
        teamLogo:{type:String}, 
        whatsappNumber:{type:Number}
    },
    wallet:{
        balance:{
            availableBalance:{type:Number, default:0},
            prizePool:{type:Number, default:0}
        },
        withdrawal:[{date:{type:String}, amount:{type:Number}, method:{type:String}, status:{type:String}, remark:{type:String}}]
    },
    dropDetails:{
        erangle:{type:String, default:""},
        rando:{type:String, default:""},
        miramar:{type:String, default:""}
    }
}, { timestamps: true });

const userModel = mongoose.model("user", userSchema);

export default userModel;