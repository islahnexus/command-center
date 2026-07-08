const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // System stats
  getStats: () => ipcRenderer.invoke('get-stats'),
  launchApp: (appPath) => ipcRenderer.invoke('launch-app', appPath),


  // Tasks
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  addTask: (task) => ipcRenderer.invoke('add-task', task),
  toggleTask: (id) => ipcRenderer.invoke('toggle-task', id),
  deleteTask: (id) => ipcRenderer.invoke('delete-task', id),

  // Schedule
  getSchedule: () => ipcRenderer.invoke('get-schedule'),
  addSchedule: (item) => ipcRenderer.invoke('add-schedule', item),
  deleteSchedule: (id) => ipcRenderer.invoke('delete-schedule', id),

  // Notes
  getNotes: () => ipcRenderer.invoke('get-notes'),
  addNote: (note) => ipcRenderer.invoke('add-note', note),
  deleteNote: (id) => ipcRenderer.invoke('delete-note', id),

  getGithub: () => ipcRenderer.invoke('get-github'),

  // AI Assistant
  chatAI: (payload) => ipcRenderer.invoke('chat-ai', payload),
  clearChat: () => ipcRenderer.invoke('clear-chat'),

  // App Launcher
  getApps: () => ipcRenderer.invoke('get-apps'),
  addApp: (appData) => ipcRenderer.invoke('add-app', appData),
  deleteApp: (id) => ipcRenderer.invoke('delete-app', id),
  browseApp: () => ipcRenderer.invoke('browse-app'),
})
