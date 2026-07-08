require('dotenv').config()
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')
const { shell } = require('electron')

const { GoogleGenerativeAI } = require('@google/generative-ai')

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' })

const chatHistory = []

ipcMain.handle('chat-ai', async (event, { message, context }) => {
  try {
    const systemContext = `
You are a personal AI assistant built into a Windows desktop Command Center app.
You have access to the user's personal data:

Current Time: ${new Date().toLocaleString()}

Tasks: ${JSON.stringify(context.tasks || [])}
Schedule: ${JSON.stringify(context.schedule || [])}
System Stats: ${JSON.stringify(context.stats || {})}
Notes: ${JSON.stringify(context.notes || [])}
GitHub: ${JSON.stringify(context.github || {})}

Be helpful, concise, and friendly. When referring to their data, be specific.
If asked about tasks, schedule, notes or github — use the data provided above.
Keep responses short unless asked for detail.
    `

    chatHistory.push({
      role: 'user',
      parts: [{ text: message }]
    })

    const chat = model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: systemContext }]
        },
        {
          role: 'model',
          parts: [{ text: 'Understood! I am your personal Command Center assistant. I have access to your tasks, schedule, notes, GitHub data, and system stats. How can I help you today?' }]
        },
        ...chatHistory.slice(0, -1)
      ]
    })

    const result = await chat.sendMessage(message)
    const response = result.response.text()

    chatHistory.push({
      role: 'model',
      parts: [{ text: response }]
    })

    // Keep history manageable
    if (chatHistory.length > 20) {
      chatHistory.splice(0, 2)
    }

    return { response }
  } catch (e) {
    console.error('Gemini error:', e)
    return { error: e.message }
  }
})

ipcMain.handle('clear-chat', () => {
  chatHistory.length = 0
  return true
})


const fetch = require('node-fetch')

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_HEADERS = {
  'Authorization': `token ${GITHUB_TOKEN}`,
  'Accept': 'application/vnd.github.v3+json'
}

ipcMain.handle('get-github', async () => {
  try {
    // Get user profile
    const userRes = await fetch('https://api.github.com/user', {
      headers: GITHUB_HEADERS
    })
    const user = await userRes.json()

    // Get repos
    const reposRes = await fetch('https://api.github.com/user/repos?sort=updated&per_page=10', {
      headers: GITHUB_HEADERS
    })
    const repos = await reposRes.json()

    // Get pull requests across all repos
    const prsRes = await fetch(`https://api.github.com/search/issues?q=author:${user.login}+type:pr+state:open`, {
      headers: GITHUB_HEADERS
    })
    const prs = await prsRes.json()

    // Get issues across all repos
    const issuesRes = await fetch(`https://api.github.com/search/issues?q=author:${user.login}+type:issue+state:open`, {
      headers: GITHUB_HEADERS
    })
    const issues = await issuesRes.json()

    // Get recent activity
    const activityRes = await fetch(`https://api.github.com/users/${user.login}/events?per_page=5`, {
      headers: GITHUB_HEADERS
    })
    const activity = await activityRes.json()

    return {
      user: {
        name: user.name || user.login,
        login: user.login,
        avatar: user.avatar_url,
        publicRepos: user.public_repos,
        followers: user.followers
      },
      repos: repos.map(r => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        description: r.description,
        stars: r.stargazers_count,
        language: r.language,
        updatedAt: r.updated_at,
        url: r.html_url,
        private: r.private,
        openIssues: r.open_issues_count
      })),
      pullRequests: prs.items?.map(pr => ({
        id: pr.id,
        title: pr.title,
        repo: pr.repository_url.split('/').slice(-2).join('/'),
        url: pr.html_url,
        createdAt: pr.created_at
      })) || [],
      issues: issues.items?.map(issue => ({
        id: issue.id,
        title: issue.title,
        repo: issue.repository_url.split('/').slice(-2).join('/'),
        url: issue.html_url,
        createdAt: issue.created_at
      })) || [],
      activity: activity.map(e => ({
        id: e.id,
        type: e.type,
        repo: e.repo.name,
        createdAt: e.created_at
      }))
    }
  } catch (e) {
    console.error('GitHub API error:', e)
    return { error: e.message }
  }
})




ipcMain.handle('launch-app', (event, appPath) => {
  const { spawn } = require('child_process')
  spawn(appPath, [], { detached: true, stdio: 'ignore' }).unref()
  return true
})

let tasksFile = path.join(app.getPath('userData'), 'tasks.json')
let tasks = []

function loadTasks() {
  try {
    if (fs.existsSync(tasksFile)) {
      return JSON.parse(fs.readFileSync(tasksFile, 'utf-8'))
    }
  } catch (e) {
    console.error('Error loading tasks:', e)
  }
  return []
}

function saveTasks(tasks) {
  fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2))
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  win.loadURL('http://localhost:5173')
}

// IPC: Get system stats from Python
ipcMain.handle('get-stats', async () => {
  return new Promise((resolve, reject) => {
    const statsPath = path.join(__dirname, '..', 'python', 'stats.py')
    console.log('Running Python script at:', statsPath)

    const python = spawn('py', [statsPath])
    let data = ''
    let errorData = ''

    python.stdout.on('data', (chunk) => {
      data += chunk.toString()
    })

    python.stderr.on('data', (chunk) => {
      errorData += chunk.toString()
      console.error('Python stderr:', chunk.toString())
    })

    python.on('close', (code) => {
      console.log('Python process closed with code:', code)
      console.log('Python output:', data)

      if (code !== 0) {
        console.error('Python error:', errorData)
        reject(new Error(`Python script failed: ${errorData}`))
        return
      }

      try {
        const result = JSON.parse(data)
        resolve(result)
      } catch (e) {
        console.error('Failed to parse Python JSON:', data)
        reject(e)
      }
    })

    python.on('error', (err) => {
      console.error('Failed to spawn Python process:', err)
      reject(err)
    })
  })
})

// IPC: Tasks
ipcMain.handle('get-tasks', () => {
  return tasks
})

ipcMain.handle('add-task', (event, task) => {
  const id = Date.now().toString()
  tasks.push({ id, ...task, done: false, createdAt: new Date().toISOString() })
  saveTasks(tasks)
  return id
})

ipcMain.handle('toggle-task', (event, id) => {
  const task = tasks.find(t => t.id === id)
  if (task) {
    task.done = !task.done
    saveTasks(tasks)
  }
})

ipcMain.handle('delete-task', (event, id) => {
  tasks = tasks.filter(t => t.id !== id)
  saveTasks(tasks)
})

let scheduleFile = path.join(app.getPath('userData'), 'schedule.json')
let schedule = []

function loadSchedule() {
  try {
    if (fs.existsSync(scheduleFile)) {
      return JSON.parse(fs.readFileSync(scheduleFile, 'utf-8'))
    }
  } catch (e) {
    console.error('Error loading schedule:', e)
  }
  return []
}

function saveSchedule(data) {
  fs.writeFileSync(scheduleFile, JSON.stringify(data, null, 2))
}

ipcMain.handle('get-schedule', () => {
  return schedule
})

ipcMain.handle('add-schedule', (event, item) => {
  const id = Date.now().toString()
  schedule.push({ id, ...item })
  saveSchedule(schedule)
  return id
})

ipcMain.handle('delete-schedule', (event, id) => {
  schedule = schedule.filter(s => s.id !== id)
  saveSchedule(schedule)
})

let notesFile = path.join(app.getPath('userData'), 'notes.json')
let notes = []

function loadNotes() {
  try {
    if (fs.existsSync(notesFile)) {
      return JSON.parse(fs.readFileSync(notesFile, 'utf-8'))
    }
  } catch (e) {
    console.error('Error loading notes:', e)
  }
  return []
}

function saveNotes(data) {
  fs.writeFileSync(notesFile, JSON.stringify(data, null, 2))
}

ipcMain.handle('get-notes', () => {
  return notes
})

ipcMain.handle('add-note', (event, note) => {
  const id = Date.now().toString()
  notes.unshift({
    id,
    content: note.content,
    createdAt: new Date().toISOString()
  })
  saveNotes(notes)
  return id
})

ipcMain.handle('delete-note', (event, id) => {
  notes = notes.filter(n => n.id !== id)
  saveNotes(notes)
})

let appsFile = path.join(app.getPath('userData'), 'apps.json')
let savedApps = []

function loadApps() {
  try {
    if (fs.existsSync(appsFile)) {
      return JSON.parse(fs.readFileSync(appsFile, 'utf-8'))
    }
  } catch (e) {
    console.error('Error loading apps:', e)
  }
  return []
}

function saveApps(data) {
  fs.writeFileSync(appsFile, JSON.stringify(data, null, 2))
}

ipcMain.handle('get-apps', () => {
  return savedApps
})

ipcMain.handle('add-app', (event, appData) => {
  const id = Date.now().toString()
  savedApps.push({ id, ...appData })
  saveApps(savedApps)
  return id
})

ipcMain.handle('delete-app', (event, id) => {
  savedApps = savedApps.filter(a => a.id !== id)
  saveApps(savedApps)
})

ipcMain.handle('browse-app', async () => {
  const { dialog } = require('electron')
  const result = await dialog.showOpenDialog({
    title: 'Select Application',
    filters: [{ name: 'Executable', extensions: ['exe'] }],
    properties: ['openFile']
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

// App startup
app.whenReady().then(() => {
  tasks = loadTasks()
  schedule = loadSchedule()
  notes = loadNotes()
  savedApps = loadApps()
  createWindow()


  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
console.log('Token loaded:', process.env.GITHUB_TOKEN ? 'YES ✓' : 'NO ✗')
