import path from 'path'
import { fileURLToPath } from 'url'
import cookieParser from 'cookie-parser'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import routes from './routes/index.js'
import attachUser from './middleware/attachUser.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.info('Connected to MongoDB'))
  .catch(err => console.error('Error connecting to MongoDB:', err))

const app = express()
const PORT = process.env.PORT || 4000

app.use(
  cors({
    origin: true,
    credentials: true,
  })
)
app.use(express.json())
app.use(cookieParser())
app.use(attachUser)

app.use('/api', routes)

// Serve frontend build static files in production
const distPath = path.join(__dirname, '../frontend/dist')
app.use(express.static(distPath))
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'))
})

app.listen(PORT, err => {
  if (err) {
    console.error('Error starting the server:', err)
    return
  }
  console.info(`Server is running on port ${PORT}`)
})
