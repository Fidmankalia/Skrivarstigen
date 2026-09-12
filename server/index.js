import express from 'express'
import rateLimit from 'express-rate-limit'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const client = new Anthropic()
const app = express()
app.use(express.json())
// Korrekt IP-igenkänning bakom en reverse proxy (t.ex. Render) vid publicering.
app.set('trust proxy', 1)

const PORT = process.env.PORT || 3001
const MODEL = 'claude-haiku-4-5'
const MAX_CHAPTERS = Number(process.env.MAX_CHAPTERS) || 8

// --- Skydd mot missbruk ---------------------------------------------------
// Lager 1: gräns per person/enhet (IP), så ingen enskild kan spamma anrop.
const PER_IP_LIMIT = Number(process.env.PER_IP_HOURLY_LIMIT) || 30
const storyRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 timme
  limit: PER_IP_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'För många berättelseförfrågningar från din enhet just nu. Vänta en stund och försök igen.' },
})

// Lager 2: dagligt totaltak för hela appen - en säkerhetsbrytare som håller
// nere den maximala kostnaden även om länken sprids mer än väntat.
const DAILY_LIMIT = Number(process.env.DAILY_REQUEST_LIMIT) || 200
let dailyCount = 0
let dailyResetAt = getNextMidnight()

function getNextMidnight() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).getTime()
}

function dailyBudgetGuard(req, res, next) {
  if (Date.now() >= dailyResetAt) {
    dailyCount = 0
    dailyResetAt = getNextMidnight()
  }
  if (dailyCount >= DAILY_LIMIT) {
    return res.status(503).json({ error: 'Skrivstigen har nått sin dagliga gräns för AI-berättelser. Försök igen imorgon.' })
  }
  dailyCount += 1
  next()
}

app.use('/api/story', storyRateLimiter, dailyBudgetGuard)
// ---------------------------------------------------------------------------

const StoryStepSchema = z.object({
  text: z.string().describe('Nästa stycke i berättelsen, 3-6 meningar, på det begärda språket.'),
  isEnding: z.boolean().describe('True om detta stycke är berättelsens definitiva slut, annars false.'),
  choices: z
    .array(z.string())
    .max(2)
    .describe('Exakt två korta handlingsval om isEnding är false. Tom lista om isEnding är true.'),
})

const SYSTEM_PROMPT_SV = `Du är berättarrösten i den svenska appen "Skrivstigen" - en interaktiv berättelseapp där läsaren väljer vad som händer härnäst.

Regler:
- Skriv alltid på svenska, i en varm, litterär sagoberättarton.
- Håll varje textstycke kort: 3-6 meningar.
- Anpassa stämning och ordval efter angiven genre (t.ex. Skräck ska kännas olustig men aldrig grafiskt våldsam; Romantik ska vara varm men aldrig sexuellt explicit - appen ska passa alla åldrar).
- Bygg alltid vidare på berättelsen hittills utan att motsäga tidigare händelser.
- Avsluta stycket vid en naturlig vändpunkt, utan att avslöja vad som händer härnäst.
- Ge exakt två korta, konkreta handlingsval (max ca 8 ord vardera) för vad huvudpersonen kan göra nu. Valen ska vara tydligt olika från varandra.
- Skriv aldrig ut "Val A" eller liknande etiketter i valen - bara själva handlingen, t.ex. "Följa det svaga ljuset mellan träden".
- Om anropet säger att detta ska vara sista stycket: skriv ett tillfredsställande, avrundat slut som knyter ihop berättelsen (inget cliffhanger, inga nya mysterier). Sätt isEnding till true och choices till en tom lista - inga fler val ska erbjudas.
- Annars: sätt isEnding till false och ge alltid exakt två handlingsval.`

const SYSTEM_PROMPT_EN = `You are the narrator voice in "Skrivstigen" - a Swedish interactive story app where the reader chooses what happens next.

Rules:
- Always write in English, in a warm, literary fairytale-narrator tone.
- Keep each passage short: 3-6 sentences.
- Adapt mood and word choice to the given genre (e.g. Skräck/Horror should feel unsettling but never graphically violent; Romantik/Romance should be warm but never sexually explicit - the app should suit all ages).
- Genre names may be given in Swedish - interpret them correctly: Skräck = Horror, Äventyr = Adventure, Mysterie = Mystery, Romantik = Romance, Fantasy and Sci-fi are unchanged.
- Always build on the story so far without contradicting earlier events.
- End the passage at a natural turning point, without revealing what happens next.
- Give exactly two short, concrete action choices (max ~8 words each) for what the protagonist can do now. The choices must be clearly different from each other.
- Never print labels like "Choice A" - just the action itself, e.g. "Follow the faint light between the trees".
- If the request says this should be the final passage: write a satisfying, conclusive ending that ties the story together (no cliffhanger, no new mysteries). Set isEnding to true and choices to an empty list - no further choices should be offered.
- Otherwise: set isEnding to false and always give exactly two action choices.`

const AGE_RULE_SV = {
  barn: 'Skriv med enkel och tydlig svenska anpassad för yngre läsare (ca 10-15 år): korta meningar, vanliga och lättförståeliga ord, undvik krångliga eller ovanliga uttryck och långa bisatser.',
  vuxen: 'Skriv med ett mognare språk anpassat för vuxna läsare: rikare ordförråd och mer varierade meningskonstruktioner när det passar berättelsen.',
}

const AGE_RULE_EN = {
  barn: 'Write in simple, clear English suited for younger readers (roughly ages 10-15): short sentences, common everyday words, avoid complicated or rare vocabulary and long subordinate clauses.',
  vuxen: 'Write with a more mature vocabulary suited for adult readers: richer language and more varied sentence structures where it fits the story.',
}

function getSystemPrompt(language, ageGroup) {
  const age = ageGroup === 'barn' ? 'barn' : 'vuxen'
  return language === 'en'
    ? `${SYSTEM_PROMPT_EN}\n- ${AGE_RULE_EN[age]}`
    : `${SYSTEM_PROMPT_SV}\n- ${AGE_RULE_SV[age]}`
}

async function generateStep(userPrompt, language, ageGroup) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 1024,
    system: getSystemPrompt(language, ageGroup),
    messages: [{ role: 'user', content: userPrompt }],
    output_config: { format: zodOutputFormat(StoryStepSchema) },
  })
  if (!response.parsed_output) throw new Error('Kunde inte tolka svaret från AI:n')
  return response.parsed_output
}

function buildStartPrompt(language, genre, idea) {
  if (language === 'en') {
    return `Genre: ${genre}
Idea to start from: ${idea?.trim() || 'No idea given - come up with something that fits the genre.'}

Write the very first passage of the story (the introduction) and give two action choices for what the protagonist does next.`
  }
  return `Genre: ${genre}
Idé att utgå från: ${idea?.trim() || 'Ingen idé angiven - hitta på något som passar genren.'}

Skriv berättelsens allra första stycke (introduktionen) och ge två handlingsval för vad huvudpersonen gör härnäst.`
}

function buildContinuePrompt(language, genre, story, choice, isFinalChapter) {
  if (language === 'en') {
    return `Genre: ${genre}

The story so far:
${story}

The protagonist chooses to: ${choice}

Write the next passage of the story as a direct continuation of the choice above.${isFinalChapter ? ' This must be the final passage - end the story now.' : ' Give two new action choices.'}`
  }
  return `Genre: ${genre}

Berättelsen hittills:
${story}

Huvudpersonen väljer att: ${choice}

Skriv nästa stycke i berättelsen som en direkt fortsättning på valet ovan.${isFinalChapter ? ' Detta måste vara det sista stycket - avsluta berättelsen nu.' : ' Ge två nya handlingsval.'}`
}

app.post('/api/story/start', async (req, res) => {
  try {
    const { genre, idea, language, ageGroup } = req.body
    if (!genre) return res.status(400).json({ error: 'Genre saknas' })
    const lang = language === 'en' ? 'en' : 'sv'
    const age = ageGroup === 'barn' ? 'barn' : 'vuxen'

    const prompt = buildStartPrompt(lang, genre, idea)
    const result = await generateStep(prompt, lang, age)
    res.json(result)
  } catch (error) {
    console.error('Fel vid start av berättelse:', error)
    res.status(502).json({ error: 'AI-anropet misslyckades' })
  }
})

app.post('/api/story/continue', async (req, res) => {
  try {
    const { genre, story, choice, language, ageGroup } = req.body
    if (!genre || !story || !choice) {
      return res.status(400).json({ error: 'Genre, berättelse eller val saknas' })
    }
    const lang = language === 'en' ? 'en' : 'sv'
    const age = ageGroup === 'barn' ? 'barn' : 'vuxen'
    const currentChapter = story.split('\n\n').length
    const isFinalChapter = currentChapter + 1 >= MAX_CHAPTERS

    const prompt = buildContinuePrompt(lang, genre, story, choice, isFinalChapter)
    const result = await generateStep(prompt, lang, age)
    res.json(result)
  } catch (error) {
    console.error('Fel vid fortsättning av berättelse:', error)
    res.status(502).json({ error: 'AI-anropet misslyckades' })
  }
})

// Servera den byggda webbappen (skapad av `npm run build`) i produktion,
// så samma server levererar både sidan och AI-anropen.
const distPath = path.join(__dirname, '..', 'dist')
app.use(express.static(distPath))
app.get(/.*/, (req, res, next) => {
  const indexPath = path.join(distPath, 'index.html')
  if (!fs.existsSync(indexPath)) return next() // t.ex. under lokal `npm run dev`, innan `dist` finns
  res.sendFile(indexPath)
})

app.listen(PORT, () => {
  console.log(`Skrivstigen-server igång på http://localhost:${PORT}`)
})
