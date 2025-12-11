require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    next();
});

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/vaultdb';
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log(`✅ Connected to MongoDB: ${mongoose.connection.name}`))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// Vault schema
const vaultSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    category: { type: String, default: 'general' },
    tags: [{ type: String }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

vaultSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

const Vault = mongoose.model('Vault', vaultSchema);

// Backups directory
const BACKUPS_DIR = path.join(__dirname, 'backups');
async function ensureBackupsDir() {
    try { await fs.mkdir(BACKUPS_DIR, { recursive: true }); } 
    catch(err) { console.error('Error creating backups directory:', err); }
}

// Backup function
async function createBackup(operation, data) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFileName = `backup-${operation}-${timestamp}.json`;
        const backupPath = path.join(BACKUPS_DIR, backupFileName);
        const allData = await Vault.find({});
        const backupData = { timestamp: new Date().toISOString(), operation, trigger: data || null, data: allData, count: allData.length };
        await fs.writeFile(backupPath, JSON.stringify(backupData, null, 2));
        console.log(`💾 Backup created: ${backupFileName}`);
        return backupFileName;
    } catch(err) { console.error('❌ Backup error:', err); throw err; }
}

// ---------------- ROUTES ---------------- //

// Root info
app.get('/', (req,res)=>{
    res.json({
        message:'Vault API Server',
        version:'2.0.0',
        features:['MongoDB Integration','Case-insensitive Search','Multi-field Sorting','Data Export','Automatic Backups','Statistics Dashboard'],
        endpoints:{
            vault: {
                getAll:'GET /api/vault',
                getOne:'GET /api/vault/:id',
                create:'POST /api/vault',
                update:'PUT /api/vault/:id',
                delete:'DELETE /api/vault/:id',
                search:'GET /api/vault/search?q=keyword',
                sort:'GET /api/vault/sort?by=name&order=asc'
            },
            features:{
                export:'GET /api/export',
                stats:'GET /api/stats',
                backups:'GET /api/backups'
            }
        }
    });
});

// ---------------- VAULT ROUTES ---------------- //

// Search must come BEFORE /:id
app.get('/api/vault/search', async (req,res)=>{
    try{
        const {q} = req.query;
        if(!q) return res.status(400).json({error:'Search query parameter "q" is required'});
        const regex = new RegExp(q,'i');
        const results = await Vault.find({$or:[{name:regex},{content:regex},{category:regex},{tags:regex}]});
        res.json({query:q, count:results.length, data:results});
    }catch(err){
        console.error(err);
        res.status(500).json({error:'Search failed', details:err.message});
    }
});

// Sort must come BEFORE /:id
app.get('/api/vault/sort', async (req,res)=>{
    try{
        let {by, order} = req.query;
        let sortBy='createdAt';
        let sortOrder=-1;
        if(by){
            if(by==='name') sortBy='name';
            else if(by==='date') sortBy='createdAt';
            else return res.status(400).json({error:'Invalid sort field. Use "name" or "date"'});
        }
        if(order){
            if(order==='asc') sortOrder=1;
            else if(order==='desc') sortOrder=-1;
            else return res.status(400).json({error:'Invalid sort order. Use "asc" or "desc"'});
        }
        const entries = await Vault.find({}).sort({[sortBy]:sortOrder});
        res.json({sortBy, order:sortOrder===1?'ascending':'descending', count:entries.length, data:entries});
    }catch(err){
        console.error(err);
        res.status(500).json({error:'Sort failed', details:err.message});
    }
});

// CRUD routes
app.post('/api/vault', async (req,res)=>{
    try{
        const {name, content, category, tags} = req.body;
        if(!name || !content) return res.status(400).json({error:'Name and content are required'});
        const newEntry = new Vault({name, content, category: category||'general', tags: tags||[]});
        await newEntry.save();
        await createBackup('CREATE',{name,id:newEntry._id});
        res.status(201).json({message:'Vault entry created successfully', data:newEntry});
    }catch(err){
        console.error(err);
        res.status(500).json({error:'Failed to create vault entry', details:err.message});
    }
});

app.get('/api/vault', async (req,res)=>{
    try{
        const entries = await Vault.find({}).sort({createdAt:-1});
        res.json({count:entries.length, data:entries});
    }catch(err){ console.error(err); res.status(500).json({error:'Failed to fetch vault entries', details:err.message}); }
});

// /:id route last
app.get('/api/vault/:id', async (req,res)=>{
    try{
        const entry = await Vault.findById(req.params.id);
        if(!entry) return res.status(404).json({error:'Vault entry not found'});
        res.json({data:entry});
    }catch(err){ console.error(err); res.status(500).json({error:'Failed to fetch vault entry', details:err.message}); }
});

app.put('/api/vault/:id', async (req,res)=>{
    try{
        const {name, content, category, tags} = req.body;
        const entry = await Vault.findByIdAndUpdate(req.params.id,{name,content,category,tags,updatedAt:Date.now()},{new:true, runValidators:true});
        if(!entry) return res.status(404).json({error:'Vault entry not found'});
        await createBackup('UPDATE',{name,id:entry._id});
        res.json({message:'Vault entry updated successfully', data:entry});
    }catch(err){ console.error(err); res.status(500).json({error:'Failed to update vault entry', details:err.message}); }
});

app.delete('/api/vault/:id', async (req,res)=>{
    try{
        const entry = await Vault.findById(req.params.id);
        if(!entry) return res.status(404).json({error:'Vault entry not found'});
        await createBackup('DELETE',{name:entry.name,id:entry._id});
        await Vault.findByIdAndDelete(req.params.id);
        res.json({message:'Vault entry deleted successfully', data:entry});
    }catch(err){ console.error(err); res.status(500).json({error:'Failed to delete vault entry', details:err.message}); }
});

// ---------------- FEATURES ---------------- //

app.get('/api/export', async (req,res)=>{
    try{
        const entries = await Vault.find({}).sort({createdAt:-1});
        let exportContent = '='.repeat(80)+'\n';
        exportContent += ' VAULT DATA EXPORT\n';
        exportContent += '='.repeat(80)+'\n\n';
        exportContent += `Export Date: ${new Date().toISOString()}\n`;
        exportContent += `Total Entries: ${entries.length}\n\n`;
        exportContent += '='.repeat(80)+'\n\n';
        entries.forEach((entry,index)=>{
            exportContent += `Entry #${index+1}\n`;
            exportContent += '-'.repeat(80)+'\n';
            exportContent += `ID: ${entry._id}\n`;
            exportContent += `Name: ${entry.name}\n`;
            exportContent += `Category: ${entry.category}\n`;
            exportContent += `Tags: ${entry.tags.join(',')||'None'}\n`;
            exportContent += `Created: ${entry.createdAt.toISOString()}\n`;
            exportContent += `Updated: ${entry.updatedAt.toISOString()}\n`;
            exportContent += `\nContent:\n${entry.content}\n\n`;
        });
        const exportPath = path.join(__dirname,'export.txt');
        await fs.writeFile(exportPath, exportContent);
        res.json({message:'Data exported successfully', file:'export.txt', path:exportPath, entries:entries.length});
    }catch(err){ console.error(err); res.status(500).json({error:'Export failed', details:err.message}); }
});

app.get('/api/stats', async (req,res)=>{
    try{
        const totalEntries = await Vault.countDocuments();
        const categoryCounts = await Vault.aggregate([{ $group:{ _id:'$category', count:{ $sum:1 } }},{ $sort:{ count:-1 } }]);
        const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate()-7);
        const recentActivity = await Vault.countDocuments({createdAt:{ $gte: sevenDaysAgo }});
        const allEntries = await Vault.find({},'tags');
        const tagCounts = {};
        allEntries.forEach(entry=>{entry.tags.forEach(tag=>{ tagCounts[tag]=(tagCounts[tag]||0)+1; });});
        const topTags = Object.entries(tagCounts).sort(([,a],[,b])=>b-a).slice(0,10).map(([tag,count])=>({tag,count}));
        const oldestEntry = await Vault.findOne().sort({createdAt:1});
        const newestEntry = await Vault.findOne().sort({createdAt:-1});
        res.json({
            summary:{totalEntries,recentActivity:{count:recentActivity, period:'last 7 days'}, oldestEntry:oldestEntry?{name:oldestEntry.name,date:oldestEntry.createdAt}:null,newestEntry:newestEntry?{name:newestEntry.name,date:newestEntry.createdAt}:null},
            categories:categoryCounts,
            topTags:topTags,
            storage:{note:'Using MongoDB - efficient storage', estimatedSize:`${totalEntries*0.5}KB (approx)` }
        });
    }catch(err){ console.error(err); res.status(500).json({error:'Failed to fetch statistics', details:err.message}); }
});

app.get('/api/backups', async (req,res)=>{
    try{
        const files = await fs.readdir(BACKUPS_DIR);
        const backups = files.filter(f=>f.endsWith('.json'));
        const backupDetails = await Promise.all(backups.map(async(file)=>{
            const stats = await fs.stat(path.join(BACKUPS_DIR,file));
            return {filename:file, size:`${(stats.size/1024).toFixed(2)} KB`, created: stats.birthtime};
        }));
        res.json({count:backups.length, backups:backupDetails.sort((a,b)=>b.created-a.created)});
    }catch(err){ console.error(err); res.status(500).json({error:'Failed to list backups', details:err.message}); }
});

app.get('/health',(req,res)=>{
    res.json({status:'OK', timestamp:new Date().toISOString(), uptime:process.uptime(), database: mongoose.connection.readyState===1?'Connected':'Disconnected'});
});

// 404 handler
app.use((req,res)=>{ res.status(404).json({error:'Endpoint not found', path:req.path, method:req.method}); });

// Error handler
app.use((err,req,res,next)=>{ console.error('Server error:',err); res.status(500).json({error:'Internal server error', message:err.message}); });

// Start server
async function startServer(){
    try{
        await ensureBackupsDir();
        app.listen(PORT, ()=>console.log(`🚀 Vault API running on http://localhost:${PORT}`));
    }catch(err){ console.error('Failed to start server:', err); process.exit(1);}
}

process.on('SIGTERM', async()=>{ await mongoose.connection.close(); process.exit(0);});
process.on('SIGINT', async()=>{ await mongoose.connection.close(); process.exit(0);});

startServer();
module.exports = app;
