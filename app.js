import express from "express"
import dotenv from "dotenv"
import ejs from "ejs"
import path from "path"
import { fileURLToPath } from "url"
import passport from "passport"
import session from "express-session"
import mongoose from "mongoose"
import './views/client/auth/google.js';

//models

import userModel from "./models/user.model.js"
import categoryModel from "./models/category.model.js"
import withdrawalModel from "./models/withdrawal.model.js"


const app = express();
dotenv.config();

// database connection 
mongoose.connect(process.env.MONGO_URI).then(()=> console.log("database connected successfully..")).catch(err=>console.log(err));


app.use(session({
    secret:"mysecret",
    resave:false,
    saveUninitialized:true
}));

app.use(passport.initialize());
app.use(passport.session());

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.set('view engine', 'ejs');
app.set('views', [
    path.join(__dirname, 'views', 'client'),
    path.join(__dirname, 'views', 'admin'),
    path.join(__dirname, 'views')
]);
app.use(express.static(path.join(__dirname, 'assets')));
app.use(express.json());

//middleware

function authCheck(req, res, next){
    if(req.isAuthenticated()){
        return next();
    }

    res.redirect("/signin")
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
    console.log(req.body);
    const details = req.body;
    const fulldetail = {...details, status:"pending", playerName:req.user.displayName, id:req.user.id};
    const checkWallet = await userModel.findOne({gglId:req.user.id}).select("wallet");
    if(checkWallet.wallet.balance.availableBalance <= 0 || checkWallet.wallet.balance.availableBalance < details.amount){
        return res.status(409).json({msg:"You Dont have sufficient balance in Your wallet"})
    };

    const addRequest = await withdrawalModel.create(fulldetail);
    const result = await addRequest.save();
    if(result){
        return res.status(200).json({msg:"Request submited successfully, wait for approvel."});
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

app.post("/team-settings", authCheck, async (req, res)=>{
    console.log(req.user.id);

    const isExist = await userModel.find({gglId:req.user.id});
    if(!isExist){
        return res.status(404).json({msg:"User does not exist"});
    }

    console.log(req.body);

    const addteam = await userModel.findOneAndUpdate({gglId:req.user.id}, { team:req.body}, {returnDocument: 'after'});
    if(!addteam){
        return res.json({msg:"something went wrong in adding team please try again later"});
    }
    console.log(addteam);
    return res.status(200).json({ msg:"team Created Successfully" });
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
       const { id, title, entryFee } = req.body;
       
       const checkBalance = await userModel.findOne({gglId:req.user.id}).select("wallet");
       if (!checkBalance || !checkBalance.wallet || !checkBalance.wallet.balance) {
           return res.status(500).json({msg:"Internal server error: wallet balance not found."});
       }
       if(checkBalance.wallet.balance.availableBalance < entryFee ){
         return res.status(400).json({msg:"You dont have sufficient balance in Your wallet"});
       };

       const isExist = await categoryModel.findOne({_id:id});
       if(!isExist){
         return res.status(404).json({msg:"This category does not exist."})
       }

       const isAlreadyRegistered = await categoryModel.findOne({_id:id, matches:{$elemMatch:{title, teams:{ $elemMatch:{teamName:getTeam.team.teamName}}}}});
       if(isAlreadyRegistered){
         return res.status(409).json({msg:"You have already booked"});
       }

       const dropDetails = await userModel.findOne({gglId:req.user.id}).select("dropDetails");
       const fullteam = {...getTeam.team, dropDetails}
       console.log(fullteam);
       const saveTeam = await categoryModel.findOneAndUpdate({ _id: id, "matches.title": title }, { $push: { "matches.$.teams": getTeam.team } },  { new: true } );
       if(saveTeam){
         const updateWallet = await userModel.findOneAndUpdate({gglId:req.user.id},  { $inc: { "wallet.balance.availableBalance": -entryFee }}, {returnDocument:'after'});
         if(updateWallet){
             return res.status(200).json({msg:"Slot booked successfully. "})
         };
       }
       return res.status(500).json({msg:"Failed to book slot. Please try again."});
   } catch (err) {
       console.error("Booking error:", err);
       return res.status(500).json({msg:"Internal server error during booking."});
   }
})

/* Admin Control Panel Routes */
app.get("/admin", (req, res)=>{
    res.redirect("/admin/dashboard");
})

app.get("/admin/dashboard", (req, res)=>{
    res.render("admin/pages/dashboard");
})

app.get("/admin/categories", (req, res)=>{
    res.render("admin/pages/categories");
})

app.get("/admin/category", (req, res)=>{
    res.render("admin/pages/category");
})

app.get("/admin/addcategory", (req, res)=>{
    res.render("admin/pages/addcategory", { baseurl });
})

app.post("/admin/addcategory", async (req, res)=>{
    console.log(req.body);
    const isExist = await categoryModel.findOne({title:req.body.title});
    let msg;
    if(!isExist){
        const category = await categoryModel.create(req.body);
        const result = await category.save();
        if(result){
             msg = "Category created successfully"
        }
    } else {
        msg = "Category already exist with this name."
    }
    
    res.json({msg});
})

app.get("/admin/addtournament", async (req, res)=>{
    const categories = await categoryModel.find().select("title -_id");
    console.log(categories);
    res.render("admin/pages/addtournament", { categories, baseurl });
})

app.post("/admin/addtournament", async (req, res)=>{
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

app.get("/admin/teams", (req, res)=>{
    res.render("admin/pages/teams");
})

app.get("/admin/withdrawals", (req, res)=>{
    res.render("admin/pages/withdrawals");
})

app.get("/admin/login", (req, res)=>{
    res.render("admin/pages/login");
})

app.get("/admin/signin", (req, res)=>{
    res.render("admin/pages/signin");
})

const port = process.env.PORT || 3000;

app.listen(port, ()=>{
    console.log(`Server is listening on ${port}`);
})
