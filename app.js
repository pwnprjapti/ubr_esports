import express from "express"
import dotenv from "dotenv"
import ejs from "ejs"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import passport from "passport"
import session from "express-session"
import mongoose from "mongoose"
import bcrypt from "bcrypt"
import './views/client/auth/google.js';
import multer from "multer"

//models

import userModel from "./models/user.model.js"
import categoryModel from "./models/category.model.js"
import withdrawalModel from "./models/withdrawal.model.js"
import adminModel from "./models/admin.model.js"


const app = express();
dotenv.config();

// database connection 
mongoose.connect(process.env.MONGO_URI).then(()=> console.log("database connected successfully..")).catch(err=>console.log(err));

app.set('trust proxy', 1);
app.use(session({
    secret:process.env.SESSION_SECRET,
    resave:false,
    saveUninitialized:true,
    cookie:{
        httpOnly:true,
        secure:process.env.NODE_ENV === "production",
        maxAge: 1000*60*60*24 // 1 day
    }
}));

app.use(passport.initialize());
app.use(passport.session());

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, 'public', 'images'));
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

app.set('view engine', 'ejs');
app.set('views', [
    path.join(__dirname, 'views', 'client'),
    path.join(__dirname, 'views', 'admin'),
    path.join(__dirname, 'views')
]);
app.use(express.static(path.join(__dirname, 'assets')));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use(express.json());

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

const baseurl = process.env.BASE_URL;

/* Client Routes */

app.get("/checksignin", (req, res)=>{
    if (req.isAuthenticated()) {
        return res.status(200).json({ authenticated: true });
    }
    return res.status(401).json({ authenticated: false });
});
app.get("/", async (req, res)=>{

    const categories = await categoryModel.find().select("title description img _id");
    console.log(categories);
    res.render("index", { categories });
})

app.get("/terms", (req, res)=>{
    res.render("pages/terms");
})

app.get("/contactus", (req, res)=>{
    res.render("pages/contactus");
})

app.get("/privacy-policy", (req, res)=>{
    res.render("pages/privacyPolicy");
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

        const withdrawalHistory = await withdrawalModel.find({id:req.user.id});
        console.log(withdrawalHistory);
        res.render("pages/withdrawal", {user, withdrawalHistory, baseurl});
     } catch (err) {
         console.error("Withdrawal error:", err);
         res.status(500).send("Internal Server Error");
     }
})

app.post("/withdrawal", authCheck, async (req, res)=>{
    try {
        console.log(req.body);
        const details = req.body;
        const amount = Number(details.amount);
        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({msg:"Invalid amount."});
        }

        // Atomically check balance and deduct immediately on request creation
        const updateWallet = await userModel.findOneAndUpdate(
            { gglId: req.user.id, "wallet.balance.availableBalance": { $gte: amount } },
            { $inc: { "wallet.balance.availableBalance": -amount } },
            { new: true }
        );

        if(!updateWallet){
            return res.status(409).json({msg:"You Dont have sufficient balance in Your wallet"})
        };

        const fulldetail = {
            ...details,
            amount: amount,
            status: "pending",
            playerName: req.user.displayName,
            id: req.user.id
        };

        const addRequest = await withdrawalModel.create(fulldetail);
        const result = await addRequest.save();
        if(result){
            return res.status(200).json({msg:"Request submited successfully, wait for approvel."});
        } else {
            // Refund if DB creation fails
            await userModel.findOneAndUpdate(
                { gglId: req.user.id },
                { $inc: { "wallet.balance.availableBalance": amount } }
            );
            return res.status(500).json({msg:"Failed to submit request. Money has been refunded."});
        }
    } catch (err) {
        console.error("Withdrawal error:", err);
        return res.status(500).json({msg:"Internal server error"});
    }
})

app.get("/category/:id", async (req, res)=>{
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
        res.render("pages/category", { matches, id, baseurl });
    } catch (err) {
        console.error("Error fetching category matches:", err);
        res.status(500).send("Internal Server Error");
    }
})

app.get("/dashboard", authCheck, async (req, res)=>{
    try {
        const categories = await categoryModel.find().select("title description img _id");
        console.log(categories);

        let isExist = await userModel.findOne({gglId:req.user.id});
        console.log(isExist)
        if(!isExist){
            const add = await userModel.create({gglId:req.user.id, wallet:{ balance:{availableBalance:0, prizePool:0}, withdrawal:[]}});
            isExist = await add.save();
            console.log(isExist);
        }

        const user = {
            name:req.user.displayName,
            dp:req.user.photos[0].value,
            balance:isExist.wallet.balance
        }

        console.log(user)
        res.render("pages/dashboard", {user, categories });
    } catch (err) {
        console.error("Dashboard error:", err);
        res.status(500).send("Internal Server Error");
    }
})

app.get("/team-settings", authCheck, async (req, res)=>{
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

         const teamSettings = await userModel.findOne({gglId:req.user.id}).select("team");
         const team = teamSettings.team;
         res.render("pages/teamSettings", {user, team, baseurl});
     } catch (err) {
         console.error("Team settings error:", err);
         res.status(500).send("Internal Server Error");
     }
})

app.post("/team-settings", authCheck, upload.single('teamLogo'), async (req, res)=>{
    try {
        console.log(req.user.id);
        const user = await userModel.findOne({gglId: req.user.id});
        if(!user){
            return res.status(404).json({msg:"User does not exist"});
        }

        const { teamName, whatsappNumber } = req.body;
        if (!teamName || !whatsappNumber) {
            return res.status(400).json({ msg: "Please fill all required fields." });
        }

        // Preserve existing logo if no new file is uploaded
        let logoName = user.team && user.team.teamLogo ? user.team.teamLogo : "";
        if (req.file) {
            // Delete old logo file if it exists
            if (logoName) {
                const oldLogoPath = path.join(__dirname, 'public', 'images', logoName);
                if (fs.existsSync(oldLogoPath)) {
                    fs.unlinkSync(oldLogoPath);
                }
            }
            logoName = req.file.filename;
        }

        const teamData = {
            teamName: teamName.trim(),
            whatsappNumber: Number(whatsappNumber),
            teamLogo: logoName
        };

        const updatedUser = await userModel.findOneAndUpdate(
            { gglId: req.user.id },
            { team: teamData },
            { new: true }
        );

        if(!updatedUser){
            return res.status(500).json({msg:"something went wrong in adding team please try again later"});
        }
        console.log(updatedUser);
        return res.status(200).json({ msg:"team Created Successfully" });
    } catch(err) {
        console.error("Error setting team details:", err);
        return res.status(500).json({ msg: "Internal server error" });
    }
})

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

app.post("/book", async (req, res)=>{
     if (!req.isAuthenticated()) {
        return res.status(401).json({ authenticated: false });
    }
    
   try {
       console.log(req.user.id);
       const getTeam = await userModel.findOne({gglId:req.user.id}).select("team");
       if (!getTeam || !getTeam.team || !getTeam.team.teamName) {
           return res.status(400).json({msg:"Please set up your team settings first."});
       }
       console.log(getTeam.team.teamName);
       const { id, title } = req.body;

       // Fetch category and match details from DB to prevent client-side entryFee tampering
       const category = await categoryModel.findOne({_id:id});
       if(!category){
         return res.status(404).json({msg:"This category does not exist."})
       }
       const match = category.matches.find(m => m.title === title);
       if(!match){
         return res.status(404).json({msg:"This match does not exist."})
       }
       const entryFee = Number(match.entryFee) || 0;

       const drop = await userModel.findOne({gglId:req.user.id}).select("dropDetails");
       console.log(drop)
       if(!drop || !drop.dropDetails){
         return res.status(400).json({msg:"Please add Drop Details "});
       };

       const isAlreadyRegistered = await categoryModel.findOne({_id:id, matches:{$elemMatch:{title, teams:{ $elemMatch:{teamName:getTeam.team.teamName}}}}});
       if(isAlreadyRegistered){
         return res.status(409).json({msg:"You have already booked"});
       }

       // Atomically deduct the balance first to prevent double-booking race conditions
       const updateWallet = await userModel.findOneAndUpdate(
           { gglId: req.user.id, "wallet.balance.availableBalance": { $gte: entryFee } },
           { $inc: { "wallet.balance.availableBalance": -entryFee } },
           { new: true }
       );
       if(!updateWallet){
         return res.status(400).json({msg:"You dont have sufficient balance in Your wallet"});
       };

       const erangle = drop.dropDetails.erangle;
       const rando = drop.dropDetails.rando;
       const miramar = drop.dropDetails.miramar;

       const teamObj = getTeam.team.toObject ? getTeam.team.toObject() : getTeam.team;
       const fullteam = {
           teamName: teamObj.teamName,
           teamLogo: teamObj.teamLogo,
           whatsappNumber: teamObj.whatsappNumber,
           dropDetails: {
               erangle: erangle || "",
               rando: rando || "",
               miramar: miramar || ""
           }
       };
       console.log(fullteam);

       // Save the team. Ensure we only push if the team is not already in the teams array
       const saveTeam = await categoryModel.findOneAndUpdate(
           { _id: id, "matches.title": title, "matches.teams.teamName": { $ne: fullteam.teamName } },
           { $push: { "matches.$.teams": fullteam } },
           { new: true }
       );

       if(saveTeam){
           return res.status(200).json({msg:"Slot booked successfully. "});
       } else {
           // Refund the balance if booking failed/prevented by double-booking filter
           await userModel.findOneAndUpdate(
               { gglId: req.user.id },
               { $inc: { "wallet.balance.availableBalance": entryFee } }
           );
           return res.status(500).json({msg:"Failed to book slot. Money has been refunded."});
       }
   } catch (err) {
       console.error("Booking error:", err);
       return res.status(500).json({msg:"Internal server error during booking."});
   }
})

/* Admin Control Panel Routes */
app.get("/admin", adminAuthCheck, (req, res)=>{
    res.redirect("/admin/dashboard");
})

app.get("/admin/dashboard", adminAuthCheck,  async (req, res)=>{
    try{
        const users = await userModel.find();
        const categories = await categoryModel.find();
        const withdrawal = await withdrawalModel.find({status:"pending"});

        res.render("admin/pages/dashboard", { users, categories, withdrawal });
    }catch(err){
        console.log(err)
    }
})

app.get("/admin/categories", adminAuthCheck, async (req, res)=>{
    const categories = await categoryModel.find();
    res.render("admin/pages/categories", { categories });
})

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
        const { title, description } = req.body;
        if (!title || !description) {
            return res.status(400).json({ msg: "Please fill all fields." });
        }
        const isExist = await categoryModel.findOne({ title: title });
        let msg;
        if(!isExist){
            const imgName = req.file ? req.file.filename : "";
            const category = await categoryModel.create({
                title,
                description,
                img: imgName
            });
            const result = await category.save();
            if(result){
                 msg = "Category created successfully"
            } else {
                 msg = "Failed to create category."
            }
        } else {
            msg = "Category already exist with this name."
        }
        
        res.json({msg});
    } catch (err) {
        console.error("Error creating category:", err);
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
            const imgPath = path.join(__dirname, 'public', 'images', category.img);
            if (fs.existsSync(imgPath)) {
                fs.unlinkSync(imgPath);
            }
        }
        
        await categoryModel.findByIdAndDelete(id);
        return res.status(200).json({ success: true, msg: "Category deleted successfully" });
    } catch (err) {
        console.error("Error deleting category:", err);
        return res.status(500).json({ success: false, msg: "Internal server error" });
    }
})

app.get("/admin/addtournament", adminAuthCheck, async (req, res)=>{
    const categories = await categoryModel.find().select("title -_id");
    console.log(categories);
    res.render("admin/pages/addtournament", { categories, baseurl });
})

app.post("/admin/addtournament", adminAuthCheck, async (req, res)=>{
    console.log(req.body);
    const match = req.body.data;
    let msg;
    const isExist = await categoryModel.findOne({title:req.body.category, matches:{ $elemMatch : { title:req.body.data.title }}});
    console.log("is exist or not  : " + isExist);
    if(!isExist){
        const add = await categoryModel.findOneAndUpdate({title:req.body.category}, { $push:{matches:match}});
        console.log("adding touramnet" + add);
        msg = "Match added succesfully"
    }else{
        msg = " match with this title already Exists"
    }

    res.json({msg});
})

app.post("/admin/category/:id/tournament/delete/:mid", adminAuthCheck, async (req, res) => {
    try {
        const { id, mid } = req.params;
        const result = await categoryModel.findByIdAndUpdate(
            id,
            { $pull: { matches: { _id: mid } } },
            { new: true }
        );
        if (result) {
            return res.status(200).json({ success: true, msg: "Tournament deleted successfully" });
        } else {
            return res.status(404).json({ success: false, msg: "Category or Tournament not found" });
        }
    } catch (err) {
        console.error("Error deleting tournament:", err);
        return res.status(500).json({ success: false, msg: "Internal server error" });
    }
})

app.get("/admin/teams/:id/:mid", adminAuthCheck, async (req, res)=>{
    try {
        const {id, mid} = req.params;
        console.log(id)
        const category = await categoryModel.findOne({ _id: id, "matches._id": mid }, { "matches.$": 1 });
        if (!category || !category.matches || category.matches.length === 0) {
            return res.status(404).send("Category or Match not found");
        }
        
        const matchesTeams = category.matches[0].teams || [];
        
        // Fetch current logos from the users collection for all these teams
        const teamNames = matchesTeams.map(t => t.teamName);
        const users = await userModel.find({ "team.teamName": { $in: teamNames } }).select("team");
        
        // Create a map of teamName -> teamLogo
        const logoMap = {};
        users.forEach(u => {
            if (u.team && u.team.teamName) {
                logoMap[u.team.teamName] = u.team.teamLogo;
            }
        });
        
        // Construct teams array with the latest logo
        const teams = matchesTeams.map(t => {
            const teamObj = t.toObject ? t.toObject() : t;
            return {
                ...teamObj,
                teamLogo: logoMap[t.teamName] || t.teamLogo || ""
            };
        });

        console.log(teams);
        res.render("admin/pages/teams", { teams });
    } catch (err) {
        console.error("Error fetching teams:", err);
        res.status(500).send("Internal Server Error");
    }
})

app.get("/admin/withdrawals", adminAuthCheck, async (req, res)=>{
    const withdrawals = await withdrawalModel.find();
    console.log(withdrawals);
    res.render("admin/pages/withdrawals", { withdrawals, baseurl });
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
            // Update status to rejected
            withdrawalReq.status = "rejected";
            await withdrawalReq.save();
            
            // Refund the balance to the user
            await userModel.findOneAndUpdate(
                { gglId: withdrawalReq.id },
                { $inc: { "wallet.balance.availableBalance": withdrawalReq.amount } }
            );
            
            return res.status(200).json({ msg: "Withdrawal rejected and funds refunded to user." });
        } else if (option === "approved") {
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
