import { useEffect, useRef, useState } from 'react'
import './App.css'

const genres = ['Fantasy', 'Mysterie', 'Skräck', 'Äventyr', 'Romantik', 'Sci-fi']

function App() {
  const [draft] = useState(() => {
    try { return JSON.parse(localStorage.getItem('skrivstigen-draft')) || null } catch { return null }
  })
  const [genre, setGenre] = useState(draft?.genre || 'Fantasy')
  const [title, setTitle] = useState(draft?.title || '')
  const [idea, setIdea] = useState(draft?.idea || '')
  const [story, setStory] = useState(draft?.story || '')
  const [choices, setChoices] = useState(draft?.choices || [])
  const [customChoice, setCustomChoice] = useState('')
  const [storyId, setStoryId] = useState(draft?.storyId || '')
  const [savedStories, setSavedStories] = useState(() => {
    try { return JSON.parse(localStorage.getItem('skrivstigen-stories')) || [] } catch { return [] }
  })
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [isSaved, setIsSaved] = useState(draft?.isSaved || false)
  const [ended, setEnded] = useState(draft?.ended || false)
  const [history, setHistory] = useState([])
  const [readingFont, setReadingFont] = useState(() => localStorage.getItem('skrivstigen-font') || 'serif')
  const [language, setLanguage] = useState(() => localStorage.getItem('skrivstigen-language') || 'sv')
  const [ageGroup, setAgeGroup] = useState(() => localStorage.getItem('skrivstigen-age-group') || 'vuxen')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [installPromptEvent, setInstallPromptEvent] = useState(null)
  const [showIosHint, setShowIosHint] = useState(true)
  const [speaking, setSpeaking] = useState(false)
  const [voiceGender, setVoiceGender] = useState(() => localStorage.getItem('skrivstigen-voice-gender') || 'man')
  const audioRef = useRef(null)
  const [voices, setVoices] = useState([])
  const [chosenVoices, setChosenVoices] = useState(() => {
    try { return JSON.parse(localStorage.getItem('skrivstigen-voices')) || {} } catch { return {} }
  })

  const isStandalone = typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true)
  const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const voiceLangPrefix = language === 'en' ? 'en' : 'sv'
  const voicesForLanguage = voices.filter((voice) => voice.lang.toLowerCase().startsWith(voiceLangPrefix))
  const chosenVoiceURI = chosenVoices[voiceLangPrefix]

  useEffect(() => {
    // Sluta läsa upp om komponenten avmonteras (t.ex. sidladdning om)
    return () => { audioRef.current?.pause(); if (speechSupported) window.speechSynthesis.cancel() }
  }, [speechSupported])

  useEffect(() => {
    if (!speechSupported) return
    function loadVoices() {
      // Nät-baserade röster (t.ex. Googles) låter oftast mer naturliga än
      // enhetens lokala standardröst - lista dem först.
      const list = [...window.speechSynthesis.getVoices()].sort((a, b) => Number(a.localService) - Number(b.localService))
      setVoices(list)
    }
    loadVoices()
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices)
  }, [speechSupported])

  useEffect(() => {
    localStorage.setItem('skrivstigen-voices', JSON.stringify(chosenVoices))
  }, [chosenVoices])

  function selectVoice(voiceURI) {
    setChosenVoices((current) => ({ ...current, [voiceLangPrefix]: voiceURI }))
  }

  function speakWithBrowserVoice(text) {
    if (!speechSupported) {
      setSpeaking(false)
      setError('Uppläsning är inte tillgänglig just nu.')
      return
    }
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = language === 'en' ? 'en-US' : 'sv-SE'
    const chosenVoice = voicesForLanguage.find((voice) => voice.voiceURI === chosenVoiceURI)
    if (chosenVoice) utterance.voice = chosenVoice
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }

  async function toggleSpeech() {
    if (speaking) {
      stopSpeech()
      return
    }
    const paragraphs = story.split('\n\n')
    const latestParagraph = paragraphs[paragraphs.length - 1]
    setSpeaking(true)
    setError('')
    try {
      const response = await fetch('/api/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: latestParagraph, language, voiceGender }),
      })
      if (!response.ok) throw new Error('speech-api-failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url) }
      audio.onerror = () => { setSpeaking(false); URL.revokeObjectURL(url) }
      await audio.play()
    } catch {
      // AI-rösten gick inte att nå (t.ex. månadskvoten slut) - använd
      // webbläsarens inbyggda röst som reserv istället för att ge upp helt.
      speakWithBrowserVoice(latestParagraph)
    }
  }

  function stopSpeech() {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (speechSupported) window.speechSynthesis.cancel()
    setSpeaking(false)
  }

  useEffect(() => {
    localStorage.setItem('skrivstigen-stories', JSON.stringify(savedStories))
  }, [savedStories])

  // Auto-sparar den pågående berättelsen (skiljt från det medvetna
  // "Spara berättelse"-biblioteket) så inget går förlorat om appen
  // stängs av misstag utan att man sparat manuellt.
  useEffect(() => {
    if (!story) {
      localStorage.removeItem('skrivstigen-draft')
      return
    }
    const currentDraft = { storyId, title, genre, idea, story, choices, ended, isSaved }
    localStorage.setItem('skrivstigen-draft', JSON.stringify(currentDraft))
  }, [storyId, title, genre, idea, story, choices, ended, isSaved])

  useEffect(() => {
    localStorage.setItem('skrivstigen-font', readingFont)
  }, [readingFont])

  useEffect(() => {
    localStorage.setItem('skrivstigen-age-group', ageGroup)
  }, [ageGroup])

  useEffect(() => {
    localStorage.setItem('skrivstigen-voice-gender', voiceGender)
  }, [voiceGender])

  useEffect(() => {
    localStorage.setItem('skrivstigen-language', language)
  }, [language])

  useEffect(() => {
    function handleBeforeInstallPrompt(event) {
      event.preventDefault()
      setInstallPromptEvent(event)
    }
    function handleAppInstalled() {
      setInstallPromptEvent(null)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  async function installApp() {
    if (!installPromptEvent) return
    installPromptEvent.prompt()
    await installPromptEvent.userChoice
    setInstallPromptEvent(null)
  }

  async function readErrorMessage(response) {
    try {
      const data = await response.json()
      if (data?.error) return data.error
    } catch {
      // svaret var inte JSON - använd standardmeddelandet
    }
    return 'Berättelse-AI:n är inte tillgänglig just nu. Försök igen om en liten stund.'
  }

  async function startStory(event) {
    event.preventDefault()
    stopSpeech()
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/story/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genre, idea, language, ageGroup }),
      })
      if (!response.ok) throw new Error(await readErrorMessage(response))
      const data = await response.json()
      setStoryId(Date.now().toString())
      setStory(data.text)
      setChoices(data.isEnding ? [] : data.choices)
      setEnded(Boolean(data.isEnding))
      setHistory([])
      setIsSaved(false)
    } catch (err) {
      setError(err.message || 'Berättelse-AI:n är inte tillgänglig just nu. Försök igen om en liten stund.')
    } finally {
      setLoading(false)
    }
  }

  async function choose(choice) {
    stopSpeech()
    setLoading(true)
    setError('')
    const previousStory = story
    const previousChoices = choices
    try {
      const response = await fetch('/api/story/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genre, story, choice, language, ageGroup }),
      })
      if (!response.ok) throw new Error(await readErrorMessage(response))
      const data = await response.json()
      setHistory((current) => [...current, { story: previousStory, choices: previousChoices }])
      setStory((current) => `${current}\n\n${data.text}`)
      setChoices(data.isEnding ? [] : data.choices)
      setEnded(Boolean(data.isEnding))
      setIsSaved(false)
    } catch (err) {
      setError(err.message || 'Berättelse-AI:n är inte tillgänglig just nu. Försök igen om en liten stund.')
    } finally {
      setLoading(false)
    }
  }

  function goBack() {
    stopSpeech()
    if (history.length === 0) {
      reset()
      return
    }
    const previous = history[history.length - 1]
    setHistory((current) => current.slice(0, -1))
    setStory(previous.story)
    setChoices(previous.choices)
    setEnded(false)
    setIsSaved(false)
    setError('')
  }

  function saveStory() {
    if (!story || !storyId) return
    const savedStory = { id: storyId, title: title || `Min ${genre.toLowerCase()}berättelse`, genre, idea, story, choices, ended, updatedAt: Date.now() }
    setSavedStories((current) => [savedStory, ...current.filter((item) => item.id !== storyId)])
    setIsSaved(true)
  }

  function submitCustomChoice(event) {
    event.preventDefault()
    const choice = customChoice.trim()
    if (!choice) return
    choose(choice)
    setCustomChoice('')
  }

  function reset() { stopSpeech(); setStory(''); setChoices([]); setIdea(''); setTitle(''); setCustomChoice(''); setStoryId(''); setLibraryOpen(false); setIsSaved(false); setEnded(false); setHistory([]); setError('') }

  function openSavedStory(savedStory) {
    stopSpeech()
    setStoryId(savedStory.id); setTitle(savedStory.title); setGenre(savedStory.genre); setIdea(savedStory.idea); setStory(savedStory.story); setChoices(savedStory.choices); setEnded(Boolean(savedStory.ended)); setHistory([]); setLibraryOpen(false); setIsSaved(true)
  }

  function deleteSavedStory(id) {
    setSavedStories((current) => current.filter((item) => item.id !== id))
    if (id === storyId) setIsSaved(false)
  }

  const chapterNumber = story ? story.split('\n\n').length : 0
  const chapterHeading = ended ? 'Slutet' : chapterNumber <= 1 ? 'Det första valet' : 'Vägen fortsätter'

  return <main className={`app-shell${story ? '' : ' has-forest-bg'}`}>
    <div className="mushrooms">
      <svg viewBox="0 0 150 100" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="30" cy="88" rx="10" ry="8" fill="#0d1810" />
        <path d="M14,72 Q30,40 46,72 Q30,80 14,72Z" fill="#5a3d7a" />
        <circle cx="22" cy="58" r="3" fill="#c9a8ff" opacity="0.9" />
        <circle cx="34" cy="52" r="2.5" fill="#c9a8ff" opacity="0.9" />
        <circle cx="40" cy="64" r="2" fill="#c9a8ff" opacity="0.7" />
        <ellipse cx="70" cy="92" rx="7" ry="5" fill="#0d1810" />
        <path d="M58,80 Q70,58 82,80 Q70,86 58,80Z" fill="#3d7a6e" />
        <circle cx="66" cy="70" r="2.2" fill="#9be8d8" opacity="0.9" />
        <circle cx="76" cy="74" r="1.8" fill="#9be8d8" opacity="0.8" />
        <ellipse cx="105" cy="86" rx="9" ry="7" fill="#0d1810" />
        <path d="M90,66 Q105,36 120,66 Q105,74 90,66Z" fill="#7a4d5a" />
        <circle cx="98" cy="52" r="2.8" fill="#ffc9e0" opacity="0.9" />
        <circle cx="110" cy="48" r="2.3" fill="#ffc9e0" opacity="0.85" />
        <circle cx="115" cy="60" r="2" fill="#ffc9e0" opacity="0.7" />
      </svg>
    </div>
    {!isStandalone && !story && installPromptEvent && <div className="install-banner"><span>Vill du ha Skrivstigen som en app på hemskärmen?</span><div className="install-banner-actions"><button onClick={installApp}>Installera appen</button><button className="dismiss" onClick={() => setInstallPromptEvent(null)} aria-label="Stäng">×</button></div></div>}
    {!isStandalone && !story && !installPromptEvent && isIos && showIosHint && <div className="install-banner"><span>Lägg till som app: tryck Dela-ikonen <svg width="14" height="16" viewBox="0 0 14 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ verticalAlign: 'middle', margin: '0 2px' }}><path d="M7 1v9M4 4l3-3 3 3M1 9v5a1 1 0 001 1h10a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg> nedtill i Safari, välj sedan "Lägg till på hemskärmen".</span><div className="install-banner-actions"><button className="dismiss" onClick={() => setShowIosHint(false)} aria-label="Stäng">×</button></div></div>}
    <header className="topbar"><button className="brand" onClick={reset}><span>✦</span> Skrivstigen</button><div className="header-actions">{savedStories.length > 0 && <button className="quiet-button" onClick={() => setLibraryOpen(!libraryOpen)}>Mina berättelser ({savedStories.length})</button>}{story && <button className={`quiet-button save-button${isSaved ? ' saved' : ''}`} onClick={saveStory} disabled={isSaved}>{isSaved ? '✓ Sparad' : 'Spara berättelse'}</button>}{story && <button className="quiet-button" onClick={reset}>Ny berättelse</button>}</div></header>
    {libraryOpen && <section className="library"><div className="library-heading"><p className="eyebrow">SPARADE BERÄTTELSER</p><button onClick={() => setLibraryOpen(false)} aria-label="Stäng">×</button></div>{savedStories.map((savedStory) => <article className="saved-story" key={savedStory.id}><button className="saved-main" onClick={() => openSavedStory(savedStory)}><span>{savedStory.genre}</span><strong>{savedStory.title}</strong><small>Fortsätt läsa →</small></button><button className="delete-story" onClick={() => deleteSavedStory(savedStory.id)} aria-label={`Radera ${savedStory.title}`}>×</button></article>)}</section>}
    {!story ? <section className="intro">
      <p className="eyebrow">DIN BERÄTTELSE BÖRJAR HÄR</p><h1>Välj vägen.<br /><em>Skriv äventyret.</em></h1><p className="lead">Sätt scenen med några ord. Sedan får du välja vad som händer i din berättelse.</p>
      <form className="story-form" onSubmit={startStory}>
        <label>Vad ska berättelsen heta? <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Till exempel: Mysteriet vid sjön" /></label>
        <label>Vilken genre passar din berättelse?<div className="genre-grid">{genres.map((item) => <button type="button" key={item} className={genre === item ? 'genre active' : 'genre'} onClick={() => setGenre(item)}>{item}</button>)}</div></label>
        <label>Vad ska berättelsen handla om?<textarea value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="Till exempel: Erik hittar en hemlig grotta vid sjön och hör någon ropa på hjälp..." rows="4" /></label>
        <label>Vilket språk ska berättelsen skrivas på?<div className="font-toggle" role="group" aria-label="Berättelsens språk"><button type="button" className={language === 'sv' ? 'active' : ''} onClick={() => setLanguage('sv')}>Svenska</button><button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>English</button></div></label>
        <label>Vem ska läsa berättelsen?<div className="font-toggle" role="group" aria-label="Åldersanpassning"><button type="button" className={ageGroup === 'barn' ? 'active' : ''} onClick={() => setAgeGroup('barn')}>Barn (upp till 12)</button><button type="button" className={ageGroup === 'vuxen' ? 'active' : ''} onClick={() => setAgeGroup('vuxen')}>Vuxen (13+)</button></div></label>
        <button className="primary-button" type="submit" disabled={loading}>{loading ? 'Skriver berättelsen …' : 'Börja berättelsen'} <span>→</span></button>
        {error && <p className="status-error">{error}</p>}
      </form>
    </section> : <section className="story-view">
      <div className="story-meta">{genre} &nbsp;•&nbsp; Kapitel {chapterNumber}</div><h1>{chapterHeading}</h1>
      <div className="story-controls">
        <div className="font-toggle" role="group" aria-label="Textstil"><button type="button" className={readingFont === 'serif' ? 'active' : ''} onClick={() => setReadingFont('serif')}>Bok</button><button type="button" className={readingFont === 'sans' ? 'active' : ''} onClick={() => setReadingFont('sans')}>Enkel</button></div>
        <button type="button" className={`speak-button${speaking ? ' speaking' : ''}`} onClick={toggleSpeech}>{speaking ? '⏸ Stoppa' : '🔊 Läs upp'}</button>
        <div className="font-toggle" role="group" aria-label="Röst"><button type="button" className={voiceGender === 'man' ? 'active' : ''} onClick={() => setVoiceGender('man')}>Man</button><button type="button" className={voiceGender === 'kvinna' ? 'active' : ''} onClick={() => setVoiceGender('kvinna')}>Kvinna</button></div>
        {speechSupported && voicesForLanguage.length > 1 && <select className="voice-select" aria-label="Reservröst" value={chosenVoiceURI || voicesForLanguage[0]?.voiceURI} onChange={(event) => selectVoice(event.target.value)}>{voicesForLanguage.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)}</select>}
      </div>
      <article className={`paper${readingFont === 'sans' ? ' sans' : ''}`}>{story.split('\n\n').map((paragraph, index, paragraphs) => <p key={index} className={index < paragraphs.length - 1 ? 'read' : ''}>{paragraph}</p>)}</article>
      <section className="choice-section">
        {!loading && <button className="undo-button" onClick={goBack} title="Ångra senaste stycket/valet">↺ Ångra</button>}
        {loading ? <p className="status-line">✎ Skriver nästa del av berättelsen …</p> : ended ? <div className="ending-note"><p className="eyebrow">SLUT</p><p>Berättelsen är klar. Spara den om du vill behålla den, ångra och välj något annat, eller börja en helt ny.</p></div> : <>
          <p className="eyebrow">VAD GÖR HUVUDPERSONEN NU?</p>
          <div className="choices">{choices.map((choice, index) => <button key={`${choice}-${index}`} className="choice" onClick={() => choose(choice)}><span>{String.fromCharCode(65 + index)}</span>{choice}</button>)}</div>
          <div className="or"><span>eller</span></div>
          <form className="custom-choice" onSubmit={submitCustomChoice}>
            <label htmlFor="custom-choice">Skriv ett eget val</label>
            <div><input id="custom-choice" value={customChoice} onChange={(event) => setCustomChoice(event.target.value)} placeholder="Till exempel: Erik smyger in i grottan med en ficklampa" /><button type="submit">Fortsätt →</button></div>
          </form>
        </>}
        {error && <p className="status-error">{error}</p>}
      </section>
    </section>}
  </main>
}

export default App