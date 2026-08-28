import { useEffect, useMemo, useRef, useState } from 'react'
import { decodeLayerPixels, getLayerCanvas, readPsd } from 'ag-psd'
import JSZip from 'jszip'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Ban,
  CheckCircle2,
  CircleDollarSign,
  Copy,
  Eye,
  ExternalLink,
  Film,
  FolderOpen,
  HelpCircle,
  ImagePlus,
  KeyRound,
  Layers3,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Share2,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import './App.css'
import { findCombinationViolation, findInvalidCombination } from './ruleValidation.js'
import { buildSmartRarityProfile, isAccessoryCategory, isFaceCategory } from './smartRarities.js'
import { extractProcreatePreview, isProcreateFile } from './procreate.js'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const LARGE_PSD_WARNING_SIZE = 100 * 1024 * 1024
const RETAINED_PSD_BITMAP_LIMIT = 512 * 1024 * 1024
const COMBO_COUNT_DISPLAY_LIMIT = 1000000
const COMBO_COUNT_TIME_BUDGET_MS = 32
const METADATA_FILE_NAME = 'metadata-file.csv'
const ONE_OF_ONE_TRAIT_TYPE = '1/1'
const RARITY_TRAIT_TYPE = 'Rarity'
const PREVIEW_DEBOUNCE_MS = 250
const PREVIEW_MAX_DIMENSION = 1024
const PREVIEW_BACKGROUNDS = ['#ffffff', '#d6dbe3', '#111827']
const X_SHARE_TEXT = 'I just forged the traits for my upcoming NFT collection on trait-forge.art, it was easy and cool'
const GENERATION_CODE_URL = '/api/codes/redeem'
const INTRO_ACCEPTED_KEY = 'trait-forge:intro-accepted:v1'
const REFERRAL_CODES = new Set(['ezzie', 'ink', 'filthy', 'smolemaru'])
const LOCAL_FREE_GENERATION = isLoopbackHostname(globalThis.location?.hostname)
const OUTPUT_FORMATS = {
  png: { mime: 'image/png', extension: 'png', label: 'PNG' },
  webp: { mime: 'image/webp', extension: 'webp', label: 'WebP' },
  jpeg: { mime: 'image/jpeg', extension: 'jpg', label: 'JPEG' },
}
const CANVAS_FORMATS = {
  original: { label: 'Original proportions', ratio: 0 },
  square: { label: 'Square · 1:1', ratio: 1 },
  portrait: { label: 'Portrait · 4:5', ratio: 4 / 5 },
  landscape: { label: 'Landscape · 16:9', ratio: 16 / 9 },
  story: { label: 'Story · 9:16', ratio: 9 / 16 },
  custom: { label: 'Custom ratio', ratio: null },
}
const DEFAULT_PROJECT = {
  name: 'Trait Collection',
  description: 'Generated with Trait Forge',
  imagePrefix: 'ipfs://CID/',
  count: 3333,
  seed: 'trait-forge',
  mode: 'random',
  outputFormat: 'webp',
  quality: 0.86,
  maxDimension: 2048,
  canvasFormat: 'original',
  customRatioWidth: 3,
  customRatioHeight: 2,
  canvasFit: 'cover',
}

const emptyRuleDraft = { first: '', second: '' }
const emptyRuleFolderDraft = { first: '', second: '' }
const emptyPositionRuleDraft = {
  first: '',
  second: '',
  firstX: 0,
  firstY: 0,
  firstScale: 100,
  secondX: 0,
  secondY: 0,
  secondScale: 100,
}
const emptyConditionDraft = { categories: [], requiredTrait: '' }
const emptyFolderConflictDraft = { first: [], second: [] }

function isLoopbackHostname(hostname = '') {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase())
}

function getInitialReferralCode() {
  const code = new URLSearchParams(globalThis.location?.search || '').get('ref')?.trim().toLowerCase() || ''
  return REFERRAL_CODES.has(code) ? code : ''
}

function App() {
  const [project, setProject] = useState(DEFAULT_PROJECT)
  const [source, setSource] = useState(null)
  const [status, setStatus] = useState('Drop in a PSD, Procreate file, or trait folders to begin.')
  const [busy, setBusy] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [samplePreviews, setSamplePreviews] = useState([])
  const [sampleCollage, setSampleCollage] = useState(null)
  const [samplePreviewOpen, setSamplePreviewOpen] = useState(false)
  const [gifFrameCount, setGifFrameCount] = useState(7)
  const [gifBusy, setGifBusy] = useState(false)
  const [previewBackground, setPreviewBackground] = useState('#ffffff')
  const [introOpen, setIntroOpen] = useState(() => readStoredValue(INTRO_ACCEPTED_KEY) !== 'yes')
  const [helpOpen, setHelpOpen] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [accessBusy, setAccessBusy] = useState(false)
  const [accessMessage, setAccessMessage] = useState('')
  const [generationCode, setGenerationCode] = useState('')
  const [referralCode, setReferralCode] = useState(getInitialReferralCode)
  const [paymentAsset, setPaymentAsset] = useState('USDC')
  const [paymentQuote, setPaymentQuote] = useState(null)
  const [paymentTransaction, setPaymentTransaction] = useState('')
  const [account, setAccount] = useState({ status: 'loading', credits: 0 })
  const [lastZipUrl, setLastZipUrl] = useState('')
  const [lastZipName, setLastZipName] = useState('')
  const [selectedCategoryIndex, setSelectedCategoryIndex] = useState(0)
  const [selectedTraitIndex, setSelectedTraitIndex] = useState(0)
  const [traitEditorOpen, setTraitEditorOpen] = useState(false)
  const [rarityPlanner, setRarityPlanner] = useState({ open: false, supply: '3333', zeroNoneCategoryIndexes: [], sourceKey: '' })
  const [traitManagerOpen, setTraitManagerOpen] = useState(false)
  const [activeRuleManagerTab, setActiveRuleManagerTab] = useState('trait-pairs')
  const [expandedCategoryIndices, setExpandedCategoryIndices] = useState([])
  const [traitDropCategoryIndex, setTraitDropCategoryIndex] = useState(null)
  const [traitTitleEditing, setTraitTitleEditing] = useState(false)
  const [renderOrderRename, setRenderOrderRename] = useState(null)
  const [managerPreviewUrls, setManagerPreviewUrls] = useState({})
  const [managerPairPreviewUrl, setManagerPairPreviewUrl] = useState('')
  const [activePositionTraitSide, setActivePositionTraitSide] = useState('first')
  const [traitEditorPreviewUrl, setTraitEditorPreviewUrl] = useState('')
  const [activeDropTarget, setActiveDropTarget] = useState('')
  const [ruleDraft, setRuleDraft] = useState(emptyRuleDraft)
  const [ruleFolderDraft, setRuleFolderDraft] = useState(emptyRuleFolderDraft)
  const [positionRuleDraft, setPositionRuleDraft] = useState(emptyPositionRuleDraft)
  const [positionRuleFolderDraft, setPositionRuleFolderDraft] = useState(emptyRuleFolderDraft)
  const [conditionDraft, setConditionDraft] = useState(emptyConditionDraft)
  const [folderConflictDraft, setFolderConflictDraft] = useState(emptyFolderConflictDraft)
  const psdInputRef = useRef(null)
  const baseInputRef = useRef(null)
  const folderInputRef = useRef(null)
  const oneOfOneInputRef = useRef(null)
  const traitFilesInputRef = useRef(null)
  const traitUploadCategoryRef = useRef(null)
  const baseFileRef = useRef(null)
  const previewTimerRef = useRef(null)
  const previewRequestRef = useRef(0)
  const samplePreviewUrlsRef = useRef([])
  const sampleCollageUrlRef = useRef('')
  const managerPreviewUrlsRef = useRef({})
  const managerPreviewSignaturesRef = useRef({})
  const managerPairPreviewUrlRef = useRef('')
  const traitEditorPreviewUrlRef = useRef('')
  const traitPreviewDragRef = useRef(null)
  const positionCanvasDragRef = useRef(null)
  const draggedTraitRef = useRef(null)
  const traitFolderDragOccurredRef = useRef(false)
  const maxEditionsCacheRef = useRef({ key: null, value: { count: 0, capped: false } })

  function acceptIntro() {
    writeStoredValue(INTRO_ACCEPTED_KEY, 'yes')
    setIntroOpen(false)
  }

  async function startGeneration() {
    if (!source || busy) return
    const generationError = getCollectionGenerationError(source)
    if (generationError) {
      setStatus(generationError)
      return
    }
    if (LOCAL_FREE_GENERATION) {
      await generateCollection()
      return
    }
    if (account.credits > 0) {
      await authorizeAndGenerate()
      return
    }
    setAccessMessage('')
    setAccessOpen(true)
  }

  function getCollectionGenerationError(activeSource) {
    if (!activeSource?.categories?.length) return 'Load a PSD or folder set first.'
    const activeCategories = getActiveCategories(activeSource.categories)
    if (!activeCategories.length) return 'Include at least one folder with a trait chance above 0.'
    const validCombinationInfo = countValidCombinations(activeCategories, getSourceRules(activeSource), COMBO_COUNT_DISPLAY_LIMIT)
    if (!validCombinationInfo.count && !validCombinationInfo.approximate) {
      return 'No valid editions remain. Remove a trait rule or restore more traits.'
    }
    return ''
  }

  async function loadAccount() {
    try {
      const response = await fetch('/api/me', { credentials: 'include' })
      if (!response.ok) throw new Error('Could not load generation credits.')
      const result = await response.json()
      const nextAccount = {
        status: 'authenticated',
        credits: Math.max(0, Number(result.credits) || 0),
      }
      setAccount(nextAccount)
      return nextAccount
    } catch {
      setAccount({ status: 'unavailable', credits: 0 })
      return null
    }
  }

  async function authorizeAndGenerate() {
    setAccessBusy(true)
    setAccessMessage('Authorizing one generation credit…')
    try {
      const response = await fetch('/api/generations/authorize', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      })
      if (!response.ok) throw new Error(await readResponseError(response, 'Could not authorize generation.'))
      const result = await response.json()
      setAccount((current) => ({ ...current, credits: Number(result.credits) || 0 }))
      setAccessOpen(false)
      await generateCollection()
    } catch (error) {
      setAccessMessage(getErrorMessage(error, 'Could not authorize generation.'))
      setAccessOpen(true)
    } finally {
      setAccessBusy(false)
    }
  }

  async function redeemGenerationCode(event) {
    event.preventDefault()
    const code = generationCode.trim()
    if (!code) {
      setAccessMessage('Enter a generation code.')
      return
    }
    setAccessBusy(true)
    setAccessMessage('Checking your code…')
    try {
      const response = await fetch(GENERATION_CODE_URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!response.ok) throw new Error(await readResponseError(response, 'That code is invalid or unavailable.'))
      const result = await response.json()
      setGenerationCode('')
      setAccount((current) => ({ ...current, credits: Number(result.credits) || 0 }))
      await authorizeAndGenerate()
    } catch (error) {
      setAccessMessage(getErrorMessage(error, 'Could not redeem that code.'))
    } finally {
      setAccessBusy(false)
    }
  }

  async function loadPaymentQuote(asset = paymentAsset) {
    setAccessBusy(true)
    setPaymentAsset(asset)
    setPaymentQuote(null)
    setAccessMessage(`Preparing a private ${asset} payment amount…`)
    try {
      const response = await fetch('/api/payments/quote', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ asset, referralCode: referralCode.trim() }),
      })
      if (!response.ok) throw new Error(await readResponseError(response, 'Could not prepare the payment.'))
      const quote = await response.json()
      setPaymentQuote(quote)
      setPaymentTransaction('')
      setAccessMessage('')
    } catch (error) {
      setPaymentQuote(null)
      setAccessMessage(getErrorMessage(error, 'Could not prepare the payment.'))
    } finally {
      setAccessBusy(false)
    }
  }

  async function claimUsdcPayment(event) {
    event.preventDefault()
    if (!paymentQuote || !paymentTransaction.trim()) return
    setAccessBusy(true)
    setAccessMessage(`Checking the confirmed ${paymentQuote.asset} transfer on Base…`)
    try {
      const response = await fetch('/api/payments/claim', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quoteId: paymentQuote.quoteId, transaction: paymentTransaction.trim() }),
      })
      if (!response.ok) throw new Error(await readResponseError(response, 'Could not verify that payment.'))
      const result = await response.json()
      setAccount((current) => ({ ...current, credits: Number(result.credits) || 0 }))
      setAccessMessage(result.alreadyClaimed ? 'This payment was already added to this browser.' : 'Payment verified. Three generation credits were added.')
      setAccessOpen(false)
      await authorizeAndGenerate()
    } catch (error) {
      setAccessMessage(getErrorMessage(error, 'Could not verify that payment.'))
      setAccessOpen(true)
    } finally {
      setAccessBusy(false)
    }
  }

  async function copyPaymentValue(label, value) {
    try {
      await navigator.clipboard.writeText(value)
      setAccessMessage(`${label} copied.`)
    } catch {
      setAccessMessage(`Could not copy automatically. Select and copy the ${label.toLowerCase()} manually.`)
    }
  }

  const combinationStructureKey = getCombinationStructureKey(source)
  if (maxEditionsCacheRef.current.key !== combinationStructureKey) {
    const categories = getActiveCategories(source?.categories || [])
    maxEditionsCacheRef.current = {
      key: combinationStructureKey,
      value: categories.length
        ? countValidCombinations(categories, getSourceRules(source), COMBO_COUNT_DISPLAY_LIMIT)
        : { count: 0, capped: false },
    }
  }
  const maxEditionsInfo = maxEditionsCacheRef.current.value
  const maxEditions = maxEditionsInfo.count
  const maxEditionsCapped = maxEditionsInfo.capped
  const oneOfOneCount = source?.oneOfOnes?.length || 0
  const samplePreviewCount = source ? Math.min(16, Math.max(1, maxEditions)) : 16
  const isMobileShareDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  const pasteModifier = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'

  const sourceSummary = useMemo(() => {
    if (!source) return []
    return source.categories.map((category, index) => ({
      index,
      name: category.name,
      count: getWeightedTraits(category).length,
      total: category.traits.length,
      enabled: category.enabled !== false,
    }))
  }, [source])

  const editionFormula = useMemo(() => {
    if (!sourceSummary.length) return ''
    return sourceSummary
      .filter((category) => category.enabled && category.count > 0)
      .map((category) => category.count.toLocaleString())
      .join(' x ')
  }, [sourceSummary])

  const selectedCategory = useMemo(() => {
    if (!source?.categories?.length) return null
    return source.categories[selectedCategoryIndex] || source.categories[0]
  }, [source, selectedCategoryIndex])

  const managerPreviewTraitKeys = useMemo(
    () => [
      ...new Set([
        ruleDraft.first,
        ruleDraft.second,
        positionRuleDraft.first,
        positionRuleDraft.second,
        conditionDraft.requiredTrait,
        ...(source?.incompatibilities || []).flatMap((rule) => [rule.first, rule.second]),
        ...(source?.positionRules || []).flatMap((rule) => [rule.first, rule.second]),
        ...(source?.categoryRequirements || []).map((rule) => rule.requiredTrait),
      ].filter(Boolean)),
    ],
    [ruleDraft.first, ruleDraft.second, positionRuleDraft.first, positionRuleDraft.second, conditionDraft.requiredTrait, source?.incompatibilities, source?.positionRules, source?.categoryRequirements],
  )

  async function ensureHolderAccess() {
    return true
  }

  useEffect(() => {
    if (LOCAL_FREE_GENERATION) {
      setAccount({ status: 'local', credits: 0 })
      return
    }
    loadAccount()
  }, [])


  useEffect(
    () => () => {
      if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current)
      previewRequestRef.current += 1
      Object.values(managerPreviewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url))
      if (managerPairPreviewUrlRef.current) URL.revokeObjectURL(managerPairPreviewUrlRef.current)
      if (traitEditorPreviewUrlRef.current) URL.revokeObjectURL(traitEditorPreviewUrlRef.current)
      samplePreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      if (sampleCollageUrlRef.current) URL.revokeObjectURL(sampleCollageUrlRef.current)
    },
    [],
  )

  useEffect(() => {
    let cancelled = false

    async function refreshManagerPreviews() {
      if (!traitManagerOpen || !source) {
        Object.values(managerPreviewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url))
        managerPreviewUrlsRef.current = {}
        managerPreviewSignaturesRef.current = {}
        setManagerPreviewUrls({})
        return
      }

      const desiredKeys = new Set(managerPreviewTraitKeys)
      const nextUrls = { ...managerPreviewUrlsRef.current }
      const nextSignatures = { ...managerPreviewSignaturesRef.current }
      for (const [key, url] of Object.entries(nextUrls)) {
        if (!desiredKeys.has(key)) {
          URL.revokeObjectURL(url)
          delete nextUrls[key]
          delete nextSignatures[key]
        }
      }

      for (const key of managerPreviewTraitKeys) {
        const trait = findTraitByKey(source, key)
        if (!trait) continue
        const signature = `${getTraitOffset(trait, 'x')}:${getTraitOffset(trait, 'y')}`
        if (nextUrls[key] && nextSignatures[key] === signature) continue
        if (nextUrls[key]) URL.revokeObjectURL(nextUrls[key])
        const blob = await renderArtwork(source, [trait], { renderMaxDimension: 240, includeBase: false })
        const url = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        nextUrls[key] = url
        nextSignatures[key] = signature
      }

      if (cancelled) return
      managerPreviewUrlsRef.current = nextUrls
      managerPreviewSignaturesRef.current = nextSignatures
      setManagerPreviewUrls(nextUrls)
    }

    refreshManagerPreviews().catch(() => {
      if (!cancelled) setManagerPreviewUrls({})
    })
    return () => {
      cancelled = true
    }
  }, [traitManagerOpen, source, managerPreviewTraitKeys])

  useEffect(() => {
    let cancelled = false
    let timer = null
    const firstTrait = source ? findTraitByKey(source, ruleDraft.first) : null
    const secondTrait = source ? findTraitByKey(source, ruleDraft.second) : null

    if (!traitManagerOpen || !source || !firstTrait || !secondTrait) {
      if (managerPairPreviewUrlRef.current) URL.revokeObjectURL(managerPairPreviewUrlRef.current)
      managerPairPreviewUrlRef.current = ''
      setManagerPairPreviewUrl('')
      return undefined
    }

    timer = window.setTimeout(async () => {
      try {
        const blob = await renderArtwork(source, [firstTrait, secondTrait], { renderMaxDimension: 360, includeBase: false })
        const url = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        if (managerPairPreviewUrlRef.current) URL.revokeObjectURL(managerPairPreviewUrlRef.current)
        managerPairPreviewUrlRef.current = url
        setManagerPairPreviewUrl(url)
      } catch {
        if (!cancelled) setManagerPairPreviewUrl('')
      }
    }, 120)

    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [traitManagerOpen, source, ruleDraft.first, ruleDraft.second])

  useEffect(() => {
    setTraitTitleEditing(false)
  }, [selectedCategoryIndex, selectedTraitIndex])

  useEffect(() => {
    let cancelled = false
    let timer = null
    const category = source?.categories?.[selectedCategoryIndex]
    const trait = category?.traits?.[selectedTraitIndex]

    if (!traitEditorOpen || !source || !trait) {
      if (traitEditorPreviewUrlRef.current) URL.revokeObjectURL(traitEditorPreviewUrlRef.current)
      traitEditorPreviewUrlRef.current = ''
      setTraitEditorPreviewUrl('')
      return undefined
    }

    timer = window.setTimeout(async () => {
      try {
        const blob = await renderArtwork(source, [trait], { renderMaxDimension: 640, includeBase: false })
        const url = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        if (traitEditorPreviewUrlRef.current) URL.revokeObjectURL(traitEditorPreviewUrlRef.current)
        traitEditorPreviewUrlRef.current = url
        setTraitEditorPreviewUrl(url)
      } catch {
        if (!cancelled) setTraitEditorPreviewUrl('')
      }
    }, 70)

    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [traitEditorOpen, source, selectedCategoryIndex, selectedTraitIndex])

  async function importLayeredFile(file) {
    if (!file) return
    if (!(await ensureHolderAccess())) return
    if (isProcreateFile(file)) {
      await importProcreateFile(file)
      return
    }
    if (!isPsdFile(file)) {
      setStatus('Drop a PSD or Procreate file into the layered artwork source.')
      return
    }

    setBusy(true)
    setStatus('Reading PSD layers...')
    try {
      if (file.size > LARGE_PSD_WARNING_SIZE) {
        const shouldTryLargePsd = window.confirm(
          `${file.name} is ${formatBytes(file.size)}. Large PSDs can exceed browser memory while layers are unpacked. Try importing it anyway?`,
        )
        if (!shouldTryLargePsd) {
          throw new Error('PSD import cancelled. You can still use Base image + Trait folders for very large artwork.')
        }
      }
      const buffer = await file.arrayBuffer()
      const psd = readPsd(buffer, {
        useRawData: true,
        skipCompositeImageData: true,
        skipThumbnail: true,
        skipLinkedFilesData: true,
      })
      const estimatedBitmapBytes = estimatePsdBitmapBytes(psd)
      const lowMemoryMode = estimatedBitmapBytes > RETAINED_PSD_BITMAP_LIMIT
      if (!lowMemoryMode) decodePsdLayerPixels(psd.children)
      const parsed = parsePsd(psd, file.name)
      parsed.lowMemoryMode = lowMemoryMode
      parsed.estimatedBitmapBytes = estimatedBitmapBytes
      setSource(parsed)
      setExpandedCategoryIndices([])
      setSelectedCategoryIndex(0)
      setRuleDraft(emptyRuleDraft)
      setRuleFolderDraft(emptyRuleFolderDraft)
      setPositionRuleDraft(emptyPositionRuleDraft)
      setPositionRuleFolderDraft(emptyRuleFolderDraft)
      setStatus(
        lowMemoryMode
          ? `Loaded ${parsed.categories.length} categories from ${file.name} in low-memory mode (${formatBytes(estimatedBitmapBytes)} expanded). Layers decode as needed.`
          : `Loaded ${parsed.categories.length} categories from ${file.name}.`,
      )
      await renderPreview(parsed)
    } catch (error) {
      setStatus(getErrorMessage(error, 'Could not read that PSD. Try a layered RGB PSD with rasterized trait layers.'))
    } finally {
      setBusy(false)
    }
  }

  async function importProcreateFile(file) {
    setBusy(true)
    setStatus('Opening Procreate artwork preview...')
    try {
      const image = await loadImageFromFile(file)
      const parsed = {
        type: 'folder',
        name: file.name,
        width: image.naturalWidth,
        height: image.naturalHeight,
        baseImage: image,
        categories: [],
        oneOfOnes: [],
        incompatibilities: [],
        positionRules: [],
        categoryRequirements: [],
        categoryConflicts: [],
      }
      setSource(parsed)
      setExpandedCategoryIndices([])
      setSelectedCategoryIndex(0)
      setRuleDraft(emptyRuleDraft)
      setRuleFolderDraft(emptyRuleFolderDraft)
      setPositionRuleDraft(emptyPositionRuleDraft)
      setPositionRuleFolderDraft(emptyRuleFolderDraft)
      setStatus(`Loaded the flattened preview from ${file.name}. Add a folder, then upload traits; export a PSD from Procreate to import editable layers.`)
      await renderPreview(parsed)
    } catch (error) {
      setStatus(getErrorMessage(error, 'Could not read that Procreate file.'))
    } finally {
      setBusy(false)
    }
  }

  async function handlePsdUpload(event) {
    const file = event.target.files?.[0]
    await importLayeredFile(file)
    event.target.value = ''
  }

  async function selectBaseFile(file) {
    if (!file) return
    if (!(await ensureHolderAccess())) return
    if (!isArtworkFile(file)) {
      setStatus('Drop a PNG, JPG, WebP, or Procreate file into Base image.')
      return
    }

    baseFileRef.current = file
    setStatus(`Base image selected: ${file.name}. Now add the trait folder.`)
  }

  async function handleBaseUpload(event) {
    const file = event.target.files?.[0]
    await selectBaseFile(file)
    event.target.value = ''
  }

  function handleDropOver(event, target) {
    event.preventDefault()
    if (!busy) {
      event.dataTransfer.dropEffect = 'copy'
      setActiveDropTarget(target)
    }
  }

  function handleDropLeave(event, target) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setActiveDropTarget((current) => (current === target ? '' : current))
    }
  }

  async function handleFileDrop(event, target) {
    event.preventDefault()
    setActiveDropTarget('')
    if (busy) return
    const file = Array.from(event.dataTransfer.files || [])[0]
    if (!file) {
      setStatus('No file was found in that drop.')
      return
    }
    if (target === 'psd') await importLayeredFile(file)
    if (target === 'base') await selectBaseFile(file)
    if (target === 'preview') {
      if (isPsdFile(file) || isProcreateFile(file)) {
        await importLayeredFile(file)
      } else if (isArtworkFile(file)) {
        await selectBaseFile(file)
      } else {
        setStatus('Drop a PSD, Procreate, PNG, JPG, or WebP file into the preview area.')
      }
    }
  }

  async function handleFolderUpload(event) {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    if (!(await ensureHolderAccess())) {
      event.target.value = ''
      return
    }

    setBusy(true)
    setStatus('Reading folder traits...')
    try {
      const parsed = await parseFolders(files, baseFileRef.current)
      setSource(parsed)
      setExpandedCategoryIndices([])
      setSelectedCategoryIndex(0)
      setRuleDraft(emptyRuleDraft)
      setRuleFolderDraft(emptyRuleFolderDraft)
      setPositionRuleDraft(emptyPositionRuleDraft)
      setPositionRuleFolderDraft(emptyRuleFolderDraft)
      setStatus(`Loaded ${parsed.categories.length} categories from folder upload.`)
      await renderPreview(parsed)
    } catch (error) {
      setStatus(getErrorMessage(error, 'Could not read those folders. Use image files inside category folders.'))
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  async function importOneOfOneFiles(files) {
    if (!source || busy) {
      setStatus('Load the collection traits before adding 1/1 artworks.')
      return
    }
    if (!(await ensureHolderAccess())) return
    const imageFiles = Array.from(files || []).filter(isArtworkFile)
    if (!imageFiles.length) {
      setStatus('No PNG, JPG, WebP, or Procreate 1/1 artworks were found.')
      return
    }

    setBusy(true)
    setStatus(`Reading ${imageFiles.length} unique 1/1 ${imageFiles.length === 1 ? 'artwork' : 'artworks'}...`)
    try {
      const existingIds = new Set((source.oneOfOnes || []).map((artwork) => artwork.id))
      const additions = []
      for (const file of imageFiles.sort((first, second) => first.name.localeCompare(second.name))) {
        const originalName = cleanName(file.name) || 'Untitled 1/1'
        let suffix = 1
        let id = makeOneOfOneId(file.name)
        while (existingIds.has(id)) {
          suffix += 1
          id = makeOneOfOneId(`${file.name}#${suffix}`)
        }
        existingIds.add(id)
        additions.push({
          id,
          originalName,
          name: originalName,
          fileName: file.name,
          image: await loadImageFromFile(file),
        })
      }
      const nextSource = { ...source, oneOfOnes: [...(source.oneOfOnes || []), ...additions] }
      setSource(nextSource)
      setStatus(`Added ${additions.length} unique 1/1 ${additions.length === 1 ? 'artwork' : 'artworks'}. Each will be generated exactly once.`)
    } catch (error) {
      setStatus(getErrorMessage(error, 'Could not add those 1/1 artworks.'))
    } finally {
      setBusy(false)
    }
  }

  async function handleOneOfOneUpload(event) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    await importOneOfOneFiles(files)
  }

  async function handleOneOfOneDrop(event) {
    event.preventDefault()
    setActiveDropTarget('')
    if (busy) return
    try {
      const files = await collectDroppedFiles(event.dataTransfer)
      await importOneOfOneFiles(files)
    } catch (error) {
      setStatus(getErrorMessage(error, 'Could not read that 1/1 folder.'))
    }
  }

  function renameOneOfOne(index, value) {
    if (!source || busy) return
    setSource({
      ...source,
      oneOfOnes: (source.oneOfOnes || []).map((artwork, artworkIndex) => (
        artworkIndex === index ? { ...artwork, name: value } : artwork
      )),
    })
  }

  function deleteOneOfOne(index) {
    if (!source || busy) return
    const artwork = source.oneOfOnes?.[index]
    if (!artwork) return
    setSource({ ...source, oneOfOnes: source.oneOfOnes.filter((_, artworkIndex) => artworkIndex !== index) })
    setStatus(`${getOneOfOneName(artwork)} removed from the 1/1s.`)
  }

  function chooseTraitFiles(categoryIndex) {
    if (!source || busy || !source.categories[categoryIndex]) return
    traitUploadCategoryRef.current = categoryIndex
    traitFilesInputRef.current?.click()
  }

  async function importTraitFiles(categoryIndex, files) {
    if (!files.length || !source || categoryIndex === null || !source.categories[categoryIndex]) return
    if (!(await ensureHolderAccess())) return

    const imageFiles = Array.from(files).filter(isArtworkFile)
    if (!imageFiles.length) {
      setStatus('Choose PNG, JPG, WebP, or Procreate trait artwork.')
      return
    }

    setBusy(true)
    const category = source.categories[categoryIndex]
    setStatus(`Adding ${imageFiles.length} ${imageFiles.length === 1 ? 'trait' : 'traits'} to ${category.name}...`)
    try {
      const existingIds = new Set(source.categories.flatMap((item) => item.traits.map((trait) => getTraitId(trait))))
      const addedTraits = []
      for (const file of imageFiles) {
        const originalName = cleanName(file.name.replace(/\.[^.]+$/, '')) || 'Untitled'
        let suffix = 1
        let id = makeTraitId(category.name, file.name)
        while (existingIds.has(id)) {
          suffix += 1
          id = makeTraitId(category.name, `${file.name}#${suffix}`)
        }
        existingIds.add(id)
        addedTraits.push({
          type: 'image',
          id,
          category: category.name,
          originalName,
          name: originalName,
          weight: 1,
          image: await loadImageFromFile(file),
          fileName: file.name,
        })
      }

      const categories = source.categories.map((item, index) => (
        index === categoryIndex ? { ...item, traits: [...item.traits, ...addedTraits] } : item
      ))
      const nextSource = { ...source, categories }
      setSource(nextSource)
      setSelectedCategoryIndex(categoryIndex)
      setSelectedTraitIndex(categories[categoryIndex].traits.length - addedTraits.length)
      setStatus(`Added ${addedTraits.length} ${addedTraits.length === 1 ? 'trait' : 'traits'} to ${category.name}.`)
      await renderPreview(nextSource)
    } catch (error) {
      setStatus(getErrorMessage(error, `Could not add traits to ${category.name}.`))
    } finally {
      setBusy(false)
    }
  }

  async function handleTraitFilesUpload(event) {
    const files = Array.from(event.target.files || [])
    const categoryIndex = traitUploadCategoryRef.current
    event.target.value = ''
    traitUploadCategoryRef.current = null
    await importTraitFiles(categoryIndex, files)
  }

  async function renderPreview(activeSource = source) {
    const categories = getActiveCategories(activeSource?.categories || [])
    if (!activeSource) return
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current)
      previewTimerRef.current = null
    }
    const requestId = previewRequestRef.current + 1
    previewRequestRef.current = requestId
    const combo = categories.length ? buildRandomCombination(categories, `${project.seed}-preview`, 0, getSourceRules(activeSource)) : []
    const blob = await renderArtwork(activeSource, combo, { renderMaxDimension: PREVIEW_MAX_DIMENSION })
    if (requestId !== previewRequestRef.current) return
    const url = URL.createObjectURL(blob)
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return url
    })
  }

  async function previewCurrentCombination() {
    if (!source || busy) return
    setBusy(true)
    setStatus('Refreshing combination preview...')
    try {
      await renderPreview(source)
      setStatus('Combination preview refreshed.')
    } catch (error) {
      setStatus(getErrorMessage(error, 'Could not refresh the combination preview.'))
    } finally {
      setBusy(false)
    }
  }

  async function previewSingleTrait(categoryIndex, traitIndex) {
    if (!source || busy || traitFolderDragOccurredRef.current) return
    const trait = source.categories[categoryIndex]?.traits[traitIndex]
    if (!trait) return
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current)
      previewTimerRef.current = null
    }
    const requestId = previewRequestRef.current + 1
    previewRequestRef.current = requestId
    setStatus(`Previewing ${getTraitMetadataName(trait)}.`)
    try {
      const blob = await renderArtwork(source, [trait], { renderMaxDimension: PREVIEW_MAX_DIMENSION })
      if (requestId !== previewRequestRef.current) return
      const url = URL.createObjectURL(blob)
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return url
      })
    } catch (error) {
      setStatus(getErrorMessage(error, 'Could not preview that trait.'))
    }
  }

  function schedulePreview(activeSource) {
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current)
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null
      renderPreview(activeSource).catch((error) => {
        setStatus(getErrorMessage(error, 'Could not refresh the preview.'))
      })
    }, PREVIEW_DEBOUNCE_MS)
  }

  async function moveCategory(index, direction) {
    if (!source || busy) return
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= source.categories.length) return

    const categories = [...source.categories]
    const [category] = categories.splice(index, 1)
    categories.splice(nextIndex, 0, category)
    const nextSource = { ...source, categories }
    setSource(nextSource)
    setSelectedCategoryIndex((current) => {
      if (current === index) return nextIndex
      if (current === nextIndex) return index
      return current
    })
    setExpandedCategoryIndices((current) => current.map((categoryIndex) => {
      if (categoryIndex === index) return nextIndex
      if (categoryIndex === nextIndex) return index
      return categoryIndex
    }))
    setStatus(`Render order updated: ${categories.map((item) => item.name).join(' -> ')}.`)
    await renderPreview(nextSource)
  }

  function addCategory() {
    if (!source || busy) return
    const existingNames = new Set(source.categories.map((category) => category.name.trim().toLocaleLowerCase()))
    let suffix = 1
    let name = 'New folder'
    while (existingNames.has(name.toLocaleLowerCase())) {
      suffix += 1
      name = `New folder ${suffix}`
    }
    const categoryIndex = source.categories.length
    const nextSource = {
      ...source,
      categories: [...source.categories, { name, enabled: true, noneWeight: 0, traits: [] }],
    }
    setSource(nextSource)
    setSelectedCategoryIndex(categoryIndex)
    setSelectedTraitIndex(0)
    setRenderOrderRename({ categoryIndex, value: name })
    setStatus(`${name} added. Rename it, then move traits into it from the trait editor.`)
  }

  async function toggleCategory(index, enabled) {
    if (!source || busy) return
    const categories = source.categories.map((category, categoryIndex) =>
      categoryIndex === index ? { ...category, enabled } : category,
    )
    const nextSource = { ...source, categories }
    setSource(nextSource)
    setSelectedCategoryIndex(index)
    setStatus(`${categories[index]?.name} ${enabled ? 'included' : 'removed from generation'}.`)
    await renderPreview(nextSource)
  }

  function updateTraitWeight(categoryIndex, traitIndex, value) {
    if (!source || busy) return
    const weight = clampDecimal(value, 0, 100)
    const categories = source.categories.map((category, index) => {
      if (index !== categoryIndex) return category
      return {
        ...category,
        traits: category.traits.map((trait, index) => (index === traitIndex ? { ...trait, weight } : trait)),
      }
    })
    const nextSource = { ...source, categories }
    setSource(nextSource)
    schedulePreview(nextSource)
  }

  function updateCategoryNoneWeight(categoryIndex, value) {
    if (!source || busy) return
    const noneWeight = clampDecimal(value, 0, 100)
    const categories = source.categories.map((category, index) => (index === categoryIndex ? { ...category, noneWeight } : category))
    const nextSource = { ...source, categories }
    setSource(nextSource)
    schedulePreview(nextSource)
  }

  function updateCategorySelectionMode(categoryIndex, selectionMode) {
    if (!source || busy || !['weighted', 'ordered'].includes(selectionMode)) return
    const categories = source.categories.map((category, index) => {
      if (index !== categoryIndex) return category
      if (selectionMode === 'ordered') {
        return {
          ...category,
          selectionMode,
          noneWeight: 0,
          traits: category.traits.map((trait) => ({ ...trait, weight: 1 })),
        }
      }
      return { ...category, selectionMode }
    })
    const nextSource = { ...source, categories }
    setSource(nextSource)
    setStatus(
      selectionMode === 'ordered'
        ? `${categories[categoryIndex].name} will cycle from the first trait to the last, then repeat.`
        : `${categories[categoryIndex].name} will use weighted rarity mixing.`,
    )
    schedulePreview(nextSource)
  }

  function openRarityPlanner() {
    if (!source || busy) return
    const sourceKey = source.categories.map((category, index) => `${index}:${category.name}:${category.traits.length}`).join('|')
    setRarityPlanner((current) => ({
      open: true,
      supply: String(Math.max(1, Math.round(Number(project.count) || 3333))),
      zeroNoneCategoryIndexes: current.sourceKey === sourceKey
        ? current.zeroNoneCategoryIndexes
        : source.categories
          .map((category, index) => (isAccessoryCategory(category.name) ? -1 : index))
          .filter((index) => index >= 0),
      sourceKey,
    }))
  }

  function toggleRarityZeroNoneCategory(categoryIndex) {
    setRarityPlanner((current) => ({
      ...current,
      zeroNoneCategoryIndexes: current.zeroNoneCategoryIndexes.includes(categoryIndex)
        ? current.zeroNoneCategoryIndexes.filter((index) => index !== categoryIndex)
        : [...current.zeroNoneCategoryIndexes, categoryIndex],
    }))
  }

  async function randomizeTraitRarities(event) {
    event?.preventDefault()
    if (!source || busy) return
    const targetCount = Math.max(1, Math.round(Number(rarityPlanner.supply) || 3333))
    const profile = buildSmartRarityProfile(source.categories, {
      targetCount,
      seed: `${project.seed}:${Date.now()}:${Math.random()}`,
      zeroNoneCategoryIndexes: rarityPlanner.zeroNoneCategoryIndexes,
    })
    const categories = profile.categories
    const validCombinationInfo = countValidCombinations(getActiveCategories(categories), getSourceRules(source), COMBO_COUNT_DISPLAY_LIMIT)

    const nextSource = { ...source, categories }
    const capacity = validCombinationInfo.approximate
      ? `${validCombinationInfo.count.toLocaleString()}+ checked before pausing the live count`
      : validCombinationInfo.capped
        ? `${validCombinationInfo.count.toLocaleString()}+`
        : validCombinationInfo.count.toLocaleString()
    const duplicateNames = findDuplicateCategoryNames(categories)
    const duplicateWarning = duplicateNames.length ? ` Rename duplicate folder name${duplicateNames.length === 1 ? '' : 's'}: ${duplicateNames.join(', ')}.` : ''
    setSource(nextSource)
    setProject((current) => ({ ...current, count: targetCount, mode: 'random' }))
    setRarityPlanner((current) => ({ ...current, open: false, supply: String(targetCount) }))
    setStatus(
      `Smart rarity plan for ${targetCount.toLocaleString()} editions: ${profile.summary.balancedFaceCategoryCount} face folder${profile.summary.balancedFaceCategoryCount === 1 ? '' : 's'} balanced evenly, ${profile.summary.optionalCategoryCount} optional folders, ${profile.summary.rareTraitCount} ultra-rare traits, about ${profile.summary.lowestExpectedCount} copies of the rarest trait, and ${capacity} valid combinations.${duplicateWarning}`,
    )
    await renderPreview(nextSource)
  }

  async function renameCategory(categoryIndex, value) {
    if (!source || busy) return
    const categoryName = source.categories[categoryIndex]?.name
    if (categoryName === undefined) return
    const nextName = value
    const categories = source.categories.map((category, index) => {
      if (index !== categoryIndex) return category
      return {
        ...category,
        name: nextName,
        traits: category.traits.map((trait) => ({ ...trait, category: nextName })),
      }
    })
    const nextSource = {
      ...source,
      categories,
      categoryRequirements: (source.categoryRequirements || []).map((rule) => (rule.category === categoryName ? { ...rule, category: nextName } : rule)),
      categoryConflicts: (source.categoryConflicts || []).map((rule) => ({
        ...rule,
        first: rule.first === categoryName ? nextName : rule.first,
        second: rule.second === categoryName ? nextName : rule.second,
      })),
    }
    setSource(nextSource)
    await renderPreview(nextSource)
  }

  function startRenderOrderRename(categoryIndex) {
    if (!source || busy) return
    setSelectedCategoryIndex(categoryIndex)
    setRenderOrderRename({ categoryIndex, value: source.categories[categoryIndex]?.name || '' })
  }

  function finishRenderOrderRename() {
    if (!renderOrderRename || !source) return
    const { categoryIndex } = renderOrderRename
    const currentName = source.categories[categoryIndex]?.name
    const nextName = renderOrderRename.value.trim()
    setRenderOrderRename(null)
    if (!nextName) {
      setStatus('Folder names cannot be empty.')
      return
    }
    if (nextName !== currentName) renameCategory(categoryIndex, nextName)
  }

  function renameTrait(categoryIndex, traitIndex, value) {
    if (!source || busy) return
    const categories = source.categories.map((category, index) => {
      if (index !== categoryIndex) return category
      return {
        ...category,
        traits: category.traits.map((trait, index) => (index === traitIndex ? { ...trait, name: value } : trait)),
      }
    })
    const nextSource = { ...source, categories }
    setSource(nextSource)
    schedulePreview(nextSource)
  }

  async function deleteTrait(categoryIndex, traitIndex) {
    if (!source || busy) return
    const category = source.categories[categoryIndex]
    const trait = category?.traits[traitIndex]
    if (!trait) return
    const traitName = getTraitMetadataName(trait)
    const confirmed = window.confirm(`Are you sure you want to delete “${traitName}” from “${category.name}”?`)
    if (!confirmed) return

    const traitKey = makeTraitKey(trait)
    const categories = source.categories.map((item, index) => (
      index === categoryIndex
        ? { ...item, traits: item.traits.filter((_, index) => index !== traitIndex) }
        : item
    ))
    const nextSource = {
      ...source,
      categories,
      incompatibilities: (source.incompatibilities || []).filter((rule) => rule.first !== traitKey && rule.second !== traitKey),
      positionRules: (source.positionRules || []).filter((rule) => rule.first !== traitKey && rule.second !== traitKey),
      categoryRequirements: (source.categoryRequirements || []).filter((rule) => rule.requiredTrait !== traitKey),
    }
    const nextTraitIndex = Math.min(traitIndex, Math.max(0, categories[categoryIndex].traits.length - 1))
    setSource(nextSource)
    setSelectedTraitIndex(nextTraitIndex)
    setRuleDraft(emptyRuleDraft)
    setPositionRuleDraft(emptyPositionRuleDraft)
    setConditionDraft(emptyConditionDraft)
    setStatus(`${traitName} deleted from ${category.name}.`)
    await renderPreview(nextSource)
  }

  function updateTraitPosition(traitKey, axis, value) {
    if (!source || busy) return
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) return
    const trait = findTraitByKey(source, traitKey)
    if (!trait) return
    const nextX = axis === 'x' ? numericValue : getTraitOffset(trait, 'x')
    const nextY = axis === 'y' ? numericValue : getTraitOffset(trait, 'y')
    updateTraitPositionPair(traitKey, nextX, nextY)
  }

  function updateTraitPositionPair(traitKey, x, y) {
    if (!source || busy) return
    const limit = Math.max(source.width, source.height) * 2
    const offsetX = Math.round(Math.max(-limit, Math.min(limit, Number(x) || 0)))
    const offsetY = Math.round(Math.max(-limit, Math.min(limit, Number(y) || 0)))
    const categories = source.categories.map((category) => ({
      ...category,
      traits: category.traits.map((trait) => (makeTraitKey(trait) === traitKey ? { ...trait, offsetX, offsetY } : trait)),
    }))
    const nextSource = { ...source, categories }
    setSource(nextSource)
    schedulePreview(nextSource)
  }

  function handleTraitPreviewPointerDown(event, trait) {
    if (!trait || busy || !source) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    traitPreviewDragRef.current = {
      pointerId: event.pointerId,
      traitKey: makeTraitKey(trait),
      startX: event.clientX,
      startY: event.clientY,
      offsetX: getTraitOffset(trait, 'x'),
      offsetY: getTraitOffset(trait, 'y'),
    }
  }

  function handleTraitPreviewPointerMove(event) {
    const drag = traitPreviewDragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !source) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const displayScale = Math.max(0.0001, Math.min(bounds.width / source.width, bounds.height / source.height))
    const nextX = drag.offsetX + (event.clientX - drag.startX) / displayScale
    const nextY = drag.offsetY + (event.clientY - drag.startY) / displayScale
    updateTraitPositionPair(drag.traitKey, nextX, nextY)
  }

  function handleTraitPreviewPointerUp(event) {
    if (traitPreviewDragRef.current?.pointerId === event.pointerId) {
      traitPreviewDragRef.current = null
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
  }

  async function moveTraitToCategory(fromCategoryIndex, traitIndex, toCategoryIndex) {
    if (!source || busy || fromCategoryIndex === toCategoryIndex) return
    const fromCategory = source.categories[fromCategoryIndex]
    const toCategory = source.categories[toCategoryIndex]
    const trait = fromCategory?.traits[traitIndex]
    if (!trait || !toCategory) return

    const categories = source.categories.map((category, categoryIndex) => {
      if (categoryIndex === fromCategoryIndex) {
        return { ...category, traits: category.traits.filter((_, index) => index !== traitIndex) }
      }
      if (categoryIndex === toCategoryIndex) {
        return { ...category, traits: [...category.traits, { ...trait, category: category.name }] }
      }
      return category
    })
    const nextSource = { ...source, categories }
    setSource(nextSource)
    setSelectedCategoryIndex(toCategoryIndex)
    setSelectedTraitIndex(Math.max(0, categories[toCategoryIndex].traits.length - 1))
    setStatus(`Moved ${getTraitMetadataName(trait)} from ${fromCategory.name} to ${toCategory.name}.`)
    await renderPreview(nextSource)
  }

  function startTraitFolderDrag(event, categoryIndex, traitIndex) {
    if (busy) {
      event.preventDefault()
      return
    }
    traitFolderDragOccurredRef.current = true
    draggedTraitRef.current = { categoryIndex, traitIndex }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', `${categoryIndex}:${traitIndex}`)
  }

  function handleTraitFolderDragOver(event, categoryIndex) {
    if (Array.from(event.dataTransfer?.types || []).includes('Files') && !busy) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setTraitDropCategoryIndex(categoryIndex)
      return
    }
    const draggedTrait = draggedTraitRef.current
    if (!draggedTrait || draggedTrait.categoryIndex === categoryIndex || busy) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setTraitDropCategoryIndex(categoryIndex)
  }

  function finishTraitFolderDrag() {
    draggedTraitRef.current = null
    setTraitDropCategoryIndex(null)
    window.setTimeout(() => {
      traitFolderDragOccurredRef.current = false
    }, 0)
  }

  async function handleTraitFolderDrop(event, categoryIndex) {
    event.preventDefault()
    const droppedFiles = Array.from(event.dataTransfer?.files || [])
    if (droppedFiles.length) {
      finishTraitFolderDrag()
      setExpandedCategoryIndices((current) => (current.includes(categoryIndex) ? current : [...current, categoryIndex]))
      await importTraitFiles(categoryIndex, droppedFiles)
      return
    }
    const draggedTrait = draggedTraitRef.current
    finishTraitFolderDrag()
    if (!draggedTrait || draggedTrait.categoryIndex === categoryIndex || busy) return
    setExpandedCategoryIndices((current) => (current.includes(categoryIndex) ? current : [...current, categoryIndex]))
    await moveTraitToCategory(draggedTrait.categoryIndex, draggedTrait.traitIndex, categoryIndex)
  }

  async function addIncompatibility() {
    if (!source || busy || !ruleDraft.first || !ruleDraft.second || ruleDraft.first === ruleDraft.second) return
    const [first, second] = normalizeRule(ruleDraft.first, ruleDraft.second)
    const ruleKey = `${first}||${second}`
    const existingRules = source.incompatibilities || []
    if (existingRules.some((rule) => makeRuleKey(rule) === ruleKey)) {
      setStatus('That trait rule already exists.')
      return
    }

    const nextSource = { ...source, incompatibilities: [...existingRules, { first, second }] }
    setSource(nextSource)
    setRuleDraft(emptyRuleDraft)
    setRuleFolderDraft(emptyRuleFolderDraft)
    setStatus('Trait rule added.')
    await renderPreview(nextSource)
  }

  async function removeIncompatibility(ruleIndex) {
    if (!source || busy) return
    const nextSource = {
      ...source,
      incompatibilities: (source.incompatibilities || []).filter((_, index) => index !== ruleIndex),
    }
    setSource(nextSource)
    setStatus('Trait rule removed.')
    await renderPreview(nextSource)
  }

  function selectPositionRuleTrait(side, traitKey) {
    const trait = source ? findTraitByKey(source, traitKey) : null
    if (traitKey) setActivePositionTraitSide(side)
    setPositionRuleDraft((current) => ({
      ...current,
      [side]: traitKey,
      [`${side}X`]: trait ? getTraitOffset(trait, 'x') : 0,
      [`${side}Y`]: trait ? getTraitOffset(trait, 'y') : 0,
      [`${side}Scale`]: 100,
    }))
  }

  function selectPositionRuleFolder(side, folderIndex) {
    const nextFolders = { ...positionRuleFolderDraft, [side]: folderIndex }
    setPositionRuleFolderDraft(nextFolders)
    if (nextFolders.first !== '' && nextFolders.second !== '') {
      const firstOptions = traitOptionsByCategory[Number(nextFolders.first)] || []
      const secondOptions = traitOptionsByCategory[Number(nextFolders.second)] || []
      const existingKeys = new Set((source?.positionRules || []).map(makeRuleKey))
      const firstPair = firstOptions
        .flatMap((firstOption) => secondOptions.map((secondOption) => ({ firstOption, secondOption })))
        .find(({ firstOption, secondOption }) => !existingKeys.has(makeRuleKey({ first: firstOption.key, second: secondOption.key })))
      if (firstPair) {
        const firstTrait = findTraitByKey(source, firstPair.firstOption.key)
        const secondTrait = findTraitByKey(source, firstPair.secondOption.key)
        setPositionRuleDraft({
          first: firstPair.firstOption.key,
          firstX: getTraitOffset(firstTrait, 'x'),
          firstY: getTraitOffset(firstTrait, 'y'),
          firstScale: 100,
          second: firstPair.secondOption.key,
          secondX: getTraitOffset(secondTrait, 'x'),
          secondY: getTraitOffset(secondTrait, 'y'),
          secondScale: 100,
        })
        setActivePositionTraitSide('second')
        return
      }
    }
    const firstOption = folderIndex === '' ? null : traitOptionsByCategory[Number(folderIndex)]?.[0]
    selectPositionRuleTrait(side, firstOption?.key || '')
  }

  function updatePositionRuleOffset(side, axis, value) {
    if (!source || busy) return
    const rawValue = String(value)
    if (!/^-?\d*$/.test(rawValue)) return
    if (rawValue === '' || rawValue === '-') {
      setPositionRuleDraft((current) => ({ ...current, [`${side}${axis.toUpperCase()}`]: rawValue }))
      return
    }
    const numericValue = Number(rawValue)
    const limit = Math.max(source.width, source.height) * 2
    const offset = Math.round(Math.max(-limit, Math.min(limit, numericValue)))
    setPositionRuleDraft((current) => ({ ...current, [`${side}${axis.toUpperCase()}`]: offset }))
  }

  function updatePositionRuleScale(side, value) {
    if (!source || busy) return
    const rawValue = String(value)
    if (!/^\d{0,3}$/.test(rawValue)) return
    setPositionRuleDraft((current) => ({ ...current, [`${side}Scale`]: rawValue }))
  }

  function handlePositionCanvasPointerDown(event) {
    if (!source || busy || !positionRuleDraft[activePositionTraitSide]) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    positionCanvasDragRef.current = {
      pointerId: event.pointerId,
      side: activePositionTraitSide,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: Number(positionRuleDraft[`${activePositionTraitSide}X`]) || 0,
      offsetY: Number(positionRuleDraft[`${activePositionTraitSide}Y`]) || 0,
    }
  }

  function handlePositionCanvasPointerMove(event) {
    const drag = positionCanvasDragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !source) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const displayScale = Math.max(0.0001, Math.min(bounds.width / source.width, bounds.height / source.height))
    const limit = Math.max(source.width, source.height) * 2
    const offsetX = Math.round(Math.max(-limit, Math.min(limit, drag.offsetX + (event.clientX - drag.startX) / displayScale)))
    const offsetY = Math.round(Math.max(-limit, Math.min(limit, drag.offsetY + (event.clientY - drag.startY) / displayScale)))
    setPositionRuleDraft((current) => ({
      ...current,
      [`${drag.side}X`]: offsetX,
      [`${drag.side}Y`]: offsetY,
    }))
  }

  function handlePositionCanvasPointerUp(event) {
    if (positionCanvasDragRef.current?.pointerId !== event.pointerId) return
    positionCanvasDragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  async function addPositionRule(advancePair = false) {
    if (!source || busy || !positionRuleDraft.first || !positionRuleDraft.second || positionRuleDraft.first === positionRuleDraft.second) return
    const firstTrait = findTraitByKey(source, positionRuleDraft.first)
    const secondTrait = findTraitByKey(source, positionRuleDraft.second)
    if (!firstTrait || !secondTrait || firstTrait.category === secondTrait.category) {
      setStatus('Position rules require traits from two different folders.')
      return
    }
    let rule = {
      first: positionRuleDraft.first,
      second: positionRuleDraft.second,
      firstOffsetX: Number(positionRuleDraft.firstX) || 0,
      firstOffsetY: Number(positionRuleDraft.firstY) || 0,
      firstScale: normalizeRuleScale(positionRuleDraft.firstScale),
      secondOffsetX: Number(positionRuleDraft.secondX) || 0,
      secondOffsetY: Number(positionRuleDraft.secondY) || 0,
      secondScale: normalizeRuleScale(positionRuleDraft.secondScale),
    }
    if (rule.first.localeCompare(rule.second) > 0) {
      rule = {
        first: rule.second,
        second: rule.first,
        firstOffsetX: rule.secondOffsetX,
        firstOffsetY: rule.secondOffsetY,
        firstScale: rule.secondScale,
        secondOffsetX: rule.firstOffsetX,
        secondOffsetY: rule.firstOffsetY,
        secondScale: rule.firstScale,
      }
    }
    const existingRules = source.positionRules || []
    if (existingRules.some((existingRule) => makeRuleKey(existingRule) === makeRuleKey(rule))) {
      setStatus('That pair already has a position rule.')
      return
    }
    const nextSource = { ...source, positionRules: [...existingRules, rule] }
    setSource(nextSource)
    if (advancePair && positionRuleFolderDraft.first !== '' && positionRuleFolderDraft.second !== '') {
      const firstOptions = traitOptionsByCategory[Number(positionRuleFolderDraft.first)] || []
      const secondOptions = traitOptionsByCategory[Number(positionRuleFolderDraft.second)] || []
      const pairs = firstOptions.flatMap((firstOption) => secondOptions.map((secondOption) => ({ firstOption, secondOption })))
      const currentIndex = pairs.findIndex(({ firstOption, secondOption }) => (
        firstOption.key === positionRuleDraft.first && secondOption.key === positionRuleDraft.second
      ))
      const existingKeys = new Set(nextSource.positionRules.map(makeRuleKey))
      const nextPair = pairs.slice(currentIndex + 1).find(({ firstOption, secondOption }) => (
        !existingKeys.has(makeRuleKey({ first: firstOption.key, second: secondOption.key }))
      ))
      const nextFirstTrait = nextPair ? findTraitByKey(source, nextPair.firstOption.key) : null
      const nextSecondTrait = nextPair ? findTraitByKey(source, nextPair.secondOption.key) : null
      if (nextFirstTrait && nextSecondTrait) {
        setPositionRuleDraft((current) => ({
          ...current,
          first: nextPair.firstOption.key,
          firstX: getTraitOffset(nextFirstTrait, 'x'),
          firstY: getTraitOffset(nextFirstTrait, 'y'),
          firstScale: 100,
          second: nextPair.secondOption.key,
          secondX: getTraitOffset(nextSecondTrait, 'x'),
          secondY: getTraitOffset(nextSecondTrait, 'y'),
          secondScale: 100,
        }))
        setActivePositionTraitSide('second')
        setStatus('Position rule saved. Advanced to the next unconfigured pair.')
      } else {
        setStatus('Position rule saved. Every pair in these folders is now configured.')
      }
    } else {
      setStatus('Pair-specific position rule added. Selections kept so you can quickly create another.')
    }
    await renderPreview(nextSource)
  }

  async function removePositionRule(ruleIndex) {
    if (!source || busy) return
    const nextSource = {
      ...source,
      positionRules: (source.positionRules || []).filter((_, index) => index !== ruleIndex),
    }
    setSource(nextSource)
    setStatus('Pair-specific position rule removed.')
    await renderPreview(nextSource)
  }

  async function addCategoryRequirement() {
    if (!source || busy || !conditionDraft.categories.length || !conditionDraft.requiredTrait) return
    const existingRules = source.categoryRequirements || []
    const existingCategories = new Set(existingRules.map((rule) => rule.category))
    const newRules = conditionDraft.categories
      .filter((category) => !existingCategories.has(category))
      .map((category) => ({ category, requiredTrait: conditionDraft.requiredTrait }))
    if (!newRules.length) {
      setStatus('Every selected folder already has a folder rule.')
      return
    }

    const nextSource = {
      ...source,
      categoryRequirements: [...existingRules, ...newRules],
    }
    setSource(nextSource)
    setConditionDraft(emptyConditionDraft)
    const skippedCount = conditionDraft.categories.length - newRules.length
    setStatus(`Added ${newRules.length} folder ${newRules.length === 1 ? 'rule' : 'rules'}.${skippedCount ? ` Skipped ${skippedCount} folder${skippedCount === 1 ? '' : 's'} with existing rules.` : ''}`)
    await renderPreview(nextSource)
  }

  async function removeCategoryRequirement(ruleIndex) {
    if (!source || busy) return
    const nextSource = {
      ...source,
      categoryRequirements: (source.categoryRequirements || []).filter((_, index) => index !== ruleIndex),
    }
    setSource(nextSource)
    setStatus('Folder rule removed.')
    await renderPreview(nextSource)
  }

  async function addCategoryConflict() {
    if (!source || busy || !folderConflictDraft.first.length || !folderConflictDraft.second.length) return
    const existingRules = source.categoryConflicts || []
    const ruleKeys = new Set(existingRules.map(makeRuleKey))
    const newRules = []
    for (const firstCategory of folderConflictDraft.first) {
      for (const secondCategory of folderConflictDraft.second) {
        if (firstCategory === secondCategory) continue
        const [first, second] = normalizeRule(firstCategory, secondCategory)
        const ruleKey = `${first}||${second}`
        if (ruleKeys.has(ruleKey)) continue
        ruleKeys.add(ruleKey)
        newRules.push({ first, second })
      }
    }
    if (!newRules.length) {
      setStatus('No new folder-conflict combinations were selected.')
      return
    }

    const nextSource = {
      ...source,
      categoryConflicts: [...existingRules, ...newRules],
    }
    setSource(nextSource)
    setFolderConflictDraft(emptyFolderConflictDraft)
    setStatus(`Added ${newRules.length} folder ${newRules.length === 1 ? 'conflict' : 'conflicts'}.`)
    await renderPreview(nextSource)
  }

  function toggleConditionCategory(category) {
    setConditionDraft((current) => ({
      ...current,
      categories: current.categories.includes(category)
        ? current.categories.filter((item) => item !== category)
        : [...current.categories, category],
    }))
  }

  function toggleFolderConflictCategory(side, category) {
    setFolderConflictDraft((current) => ({
      ...current,
      [side]: current[side].includes(category)
        ? current[side].filter((item) => item !== category)
        : [...current[side], category],
    }))
  }

  async function removeCategoryConflict(ruleIndex) {
    if (!source || busy) return
    const nextSource = {
      ...source,
      categoryConflicts: (source.categoryConflicts || []).filter((_, index) => index !== ruleIndex),
    }
    setSource(nextSource)
    setStatus('Folder conflict removed.')
    await renderPreview(nextSource)
  }

  function clearSamplePreviews() {
    samplePreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    samplePreviewUrlsRef.current = []
    if (sampleCollageUrlRef.current) URL.revokeObjectURL(sampleCollageUrlRef.current)
    sampleCollageUrlRef.current = ''
    setSamplePreviews([])
    setSampleCollage(null)
  }

  function closeSamplePreview() {
    setSamplePreviewOpen(false)
    clearSamplePreviews()
  }

  async function shareSampleCollage() {
    if (!sampleCollage) return
    const fileName = `${slugify(project.name)}-sample-collage.png`
    const file = new File([sampleCollage.blob], fileName, { type: 'image/png' })

    if (isMobileShareDevice && navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          title: 'Trait Forge preview',
          text: X_SHARE_TEXT,
          files: [file],
        })
        setStatus('Shared the collection sample collage.')
      } catch (error) {
        if (error?.name !== 'AbortError') setStatus('Could not open image sharing. Try downloading the collage instead.')
      }
      return
    }

    const intent = new URL('https://x.com/intent/tweet')
    intent.searchParams.set('text', X_SHARE_TEXT)
    let clipboardPromise = null
    if (navigator.clipboard?.write && globalThis.ClipboardItem) {
      try {
        clipboardPromise = navigator.clipboard.write([
          new ClipboardItem({ 'image/png': sampleCollage.blob }),
        ])
      } catch {
        clipboardPromise = null
      }
    }
    const composer = window.open(intent.toString(), '_blank')
    if (composer) composer.opener = null
    else window.location.assign(intent.toString())
    let copied = false
    if (clipboardPromise) {
      try {
        await clipboardPromise
        copied = true
      } catch {
        copied = false
      }
    }
    if (copied) {
      setStatus('Collage copied. Paste it into the X post composer with Ctrl+V or Command+V.')
      return
    }
    downloadBlobUrl(sampleCollage.url, fileName)
    setStatus('Collage downloaded. Attach it to the X post that just opened.')
  }

  async function generatePreviewGif() {
    const frameCount = Math.min(gifFrameCount, samplePreviews.length, 7)
    if (frameCount < 5 || gifBusy) {
      setStatus('Render at least five collection samples before generating a GIF.')
      return
    }

    setGifBusy(true)
    setStatus(`Encoding a ${frameCount}-frame collection GIF…`)
    try {
      const size = 600
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Could not create the GIF canvas.')
      const encoder = GIFEncoder()

      for (let index = 0; index < frameCount; index += 1) {
        const { image, cleanup } = await decodeCollageImage(samplePreviews[index].blob)
        context.fillStyle = previewBackground
        context.fillRect(0, 0, size, size)
        const scale = Math.min(size / image.width, size / image.height)
        const width = image.width * scale
        const height = image.height * scale
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
        cleanup()

        const rgba = context.getImageData(0, 0, size, size).data
        const palette = quantize(rgba, 128)
        const indexed = applyPalette(rgba, palette)
        encoder.writeFrame(indexed, size, size, {
          palette,
          delay: 420,
          repeat: 0,
        })
        setStatus(`Encoded GIF frame ${index + 1} of ${frameCount}…`)
        await waitForPaint()
      }

      context.fillStyle = '#0f1419'
      context.fillRect(0, 0, size, size)
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillStyle = '#8fa4bd'
      context.font = '800 30px Arial, sans-serif'
      context.fillText('COLLECTION GENERATED ON', size / 2, size / 2 - 48)
      context.fillStyle = '#ffffff'
      context.font = '900 58px Arial, sans-serif'
      context.fillText('trait-forge.art', size / 2, size / 2 + 18)
      context.fillStyle = '#fff2a8'
      context.fillRect(size / 2 - 118, size / 2 + 66, 236, 7)
      const endCardRgba = context.getImageData(0, 0, size, size).data
      const endCardPalette = quantize(endCardRgba, 128)
      encoder.writeFrame(applyPalette(endCardRgba, endCardPalette), size, size, {
        palette: endCardPalette,
        delay: 850,
        repeat: 0,
      })

      encoder.finish()
      const gifBlob = new Blob([encoder.bytes()], { type: 'image/gif' })
      const gifUrl = URL.createObjectURL(gifBlob)
      downloadBlobUrl(gifUrl, `${slugify(project.name)}-preview.gif`)
      window.setTimeout(() => URL.revokeObjectURL(gifUrl), 30_000)
      setStatus(`Downloaded a ${frameCount}-image collection GIF with a Trait Forge end card.`)
    } catch (error) {
      setStatus(getErrorMessage(error, 'Could not generate the collection GIF.'))
    } finally {
      setGifBusy(false)
    }
  }

  async function generateSamplePreview() {
    if (!(await ensureHolderAccess())) return
    if (!source?.categories?.length || busy) {
      setStatus('Load a PSD or folder set first.')
      return
    }

    const activeCategories = getActiveCategories(source.categories)
    const rules = getSourceRules(source)
    if (!activeCategories.length) {
      setStatus('Include at least one folder containing an active trait.')
      return
    }

    const validCombinationInfo = countValidCombinations(activeCategories, rules, COMBO_COUNT_DISPLAY_LIMIT)
    if (!validCombinationInfo.count && !validCombinationInfo.approximate) {
      setStatus('No valid preview combinations remain. Remove a trait rule or restore more traits.')
      return
    }

    const sampleCount = Math.min(16, Math.max(1, validCombinationInfo.count))
    clearSamplePreviews()
    setSamplePreviewOpen(true)
    setBusy(true)
    setStatus(`Rendering ${sampleCount} sample artworks...`)
    const createdUrls = []
    try {
      const combos = project.mode === 'all' && !hasOrderedCategories(activeCategories)
        ? buildCombinationsUpTo(activeCategories, rules, sampleCount)
        : buildUniqueRandomCombinations(activeCategories, sampleCount, project.seed, rules)
      if (!combos.length) throw new Error('No valid sample combinations could be selected.')

      const previews = []
      for (let index = 0; index < combos.length; index += 1) {
        const blob = await renderArtwork(source, combos[index], {
          renderMaxDimension: 420,
          canvasRatio: getProjectCanvasRatio(project),
          canvasFit: project.canvasFit,
        })
        const url = URL.createObjectURL(blob)
        createdUrls.push(url)
        previews.push({
          url,
          blob,
          edition: index + 1,
          traits: combos[index]
            .filter((trait) => !trait.isNone)
            .map((trait) => `${trait.category}: ${getTraitMetadataName(trait)}`),
        })
        if ((index + 1) % 4 === 0 || index === combos.length - 1) {
          setStatus(`Rendered ${index + 1} of ${combos.length} sample artworks...`)
          await waitForPaint()
        }
      }
      samplePreviewUrlsRef.current = createdUrls
      setSamplePreviews(previews)
      setGifFrameCount(Math.min(7, previews.length))
      setStatus('Building an 8-item sharing collage…')
      const collageBlob = await buildSampleCollage(previews.slice(0, 8), project.name, previewBackground)
      const collageUrl = URL.createObjectURL(collageBlob)
      sampleCollageUrlRef.current = collageUrl
      setSampleCollage({ blob: collageBlob, url: collageUrl, count: Math.min(8, previews.length) })
      setStatus(`Preview ready. These ${previews.length} samples use the current seed, rarities, and trait rules.`)
    } catch (error) {
      createdUrls.forEach((url) => URL.revokeObjectURL(url))
      samplePreviewUrlsRef.current = []
      setSamplePreviews([])
      setSampleCollage(null)
      setSamplePreviewOpen(false)
      setStatus(getErrorMessage(error, 'Could not render sample artworks.'))
    } finally {
      setBusy(false)
    }
  }

  async function generateCollection() {
    if (!(await ensureHolderAccess())) return
    if (!source?.categories?.length) {
      setStatus('Load a PSD or folder set first.')
      return
    }

    const activeCategories = getActiveCategories(source.categories)
    const rules = getSourceRules(source)
    if (!activeCategories.length) {
      setStatus('Include at least one folder with a trait chance above 0.')
      return
    }

    const validCombinationInfo = countValidCombinations(activeCategories, rules, COMBO_COUNT_DISPLAY_LIMIT)
    if (!validCombinationInfo.count && !validCombinationInfo.approximate) {
      setStatus('No valid editions remain. Remove a trait rule or restore more traits.')
      return
    }

    const targetCount = maxEditionsCapped
      ? clampNumber(project.count, 1, COMBO_COUNT_DISPLAY_LIMIT)
      : clampNumber(project.count, 1, Math.max(1, validCombinationInfo.count))
    const output = OUTPUT_FORMATS[project.outputFormat] || OUTPUT_FORMATS.webp
    const quality = clampNumber(project.quality * 100, 1, 100) / 100
    const maxDimension = clampNumber(project.maxDimension, 0, 12000)
    const canvasRatio = getProjectCanvasRatio(project)

    setLastZipUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return ''
    })
    setLastZipName('')
    setBusy(true)
    setStatus(`Selecting and validating ${targetCount} editions...`)
    try {
      const zip = new JSZip()
      const images = zip.folder('images')
      const oneOfOnes = source.oneOfOnes || []
      const metadataCategories = [
        ...activeCategories.map((category) => category.name),
        ...(oneOfOnes.length ? [ONE_OF_ONE_TRAIT_TYPE, RARITY_TRAIT_TYPE] : []),
      ]
      const metadataRows = []
      const manifest = []
      const combos =
        project.mode === 'all' && !hasOrderedCategories(activeCategories)
          ? buildCombinationsUpTo(activeCategories, rules, targetCount)
          : buildUniqueRandomCombinations(activeCategories, targetCount, project.seed, rules)

      if (combos.length !== targetCount) {
        throw new Error(`Only ${combos.length} unique valid combinations could be selected. Requested ${targetCount}.`)
      }
      const invalidCombination = findInvalidCombination(combos, rules)
      if (invalidCombination) {
        throw new Error(`Rule validation stopped generation at edition ${invalidCombination.index + 1}: ${invalidCombination.reason}`)
      }

      const generatedAt = new Date().toISOString()
      const projectBackup = buildProjectBackup(source, project, generatedAt)
      zip.file('project-backup.json', JSON.stringify(projectBackup, null, 2))
      zip.file(
        'generation-report.json',
        JSON.stringify(
          {
            generatedAt,
            requestedEditions: targetCount,
            validatedEditions: combos.length,
            incompatibilityRules: rules.incompatibilities.length,
            positionRules: (source.positionRules || []).length,
            categoryRequirements: rules.categoryRequirements.length,
            categoryConflicts: rules.categoryConflicts.length,
            collectionEditions: combos.length,
            oneOfOneEditions: oneOfOnes.length,
            totalEditions: combos.length + oneOfOnes.length,
            validationPassed: true,
          },
          null,
          2,
        ),
      )

      for (let index = 0; index < combos.length; index += 1) {
        const edition = index + 1
        const violation = findCombinationViolation(combos[index], rules)
        if (violation) {
          throw new Error(`Rule validation stopped generation at edition ${edition}: ${violation}`)
        }
        const blob = await renderArtwork(source, combos[index], {
          mime: output.mime,
          quality,
          maxDimension,
          canvasRatio,
          canvasFit: project.canvasFit,
        })
        const imageFileName = `${edition}.${output.extension}`
        const attributes = combos[index]
          .filter((trait) => !trait.isNone)
          .map((trait) => ({
            trait_type: trait.category,
            value: getTraitMetadataName(trait),
          }))
        images.file(imageFileName, blob)
        const tokenId = index + 1
        metadataRows.push(buildMetadataCsvRow(tokenId, imageFileName, project, metadataCategories, combos[index]))
        manifest.push({ edition, tokenId, image: `images/${imageFileName}`, metadata: METADATA_FILE_NAME, attributes })

        if ((index + 1) % 10 === 0 || index === combos.length - 1) {
          setStatus(`Generated ${index + 1} of ${combos.length} editions...`)
          await waitForPaint()
        }
      }

      for (let index = 0; index < oneOfOnes.length; index += 1) {
        const artwork = oneOfOnes[index]
        const edition = combos.length + index + 1
        const blob = await renderOneOfOneArtwork(artwork, {
          mime: output.mime,
          quality,
          maxDimension,
          canvasRatio,
          canvasFit: project.canvasFit,
        })
        const imageFileName = `${edition}.${output.extension}`
        const oneOfOneName = getOneOfOneName(artwork)
        const attributes = [
          { trait_type: ONE_OF_ONE_TRAIT_TYPE, value: oneOfOneName },
          { trait_type: RARITY_TRAIT_TYPE, value: ONE_OF_ONE_TRAIT_TYPE },
        ]
        images.file(imageFileName, blob)
        metadataRows.push(buildOneOfOneMetadataCsvRow(edition, imageFileName, project, metadataCategories, oneOfOneName))
        manifest.push({
          edition,
          tokenId: edition,
          image: `images/${imageFileName}`,
          metadata: METADATA_FILE_NAME,
          oneOfOne: true,
          attributes,
        })
        setStatus(`Added ${index + 1} of ${oneOfOnes.length} unique 1/1 artworks...`)
        await waitForPaint()
      }

      zip.file(METADATA_FILE_NAME, buildMetadataCsv(metadataCategories, metadataRows))
      zip.file('manifest.json', JSON.stringify(manifest, null, 2))
      setStatus('Packaging ZIP… 0%')
      await waitForPaint()
      let lastPackagingPercent = -1
      let lastPackagingUpdate = 0
      const zipBlob = await zip.generateAsync(
        {
          type: 'blob',
          streamFiles: true,
          // PNG, JPEG and WebP data is already compressed. Deflating it again is
          // expensive and can make large exports appear frozen on mobile Safari.
          compression: 'STORE',
        },
        ({ percent }) => {
          const nextPercent = Math.min(100, Math.floor(percent))
          const now = Date.now()
          if (nextPercent === lastPackagingPercent || (nextPercent < 100 && now - lastPackagingUpdate < 200)) return
          lastPackagingPercent = nextPercent
          lastPackagingUpdate = now
          setStatus(`Packaging ZIP… ${nextPercent}%`)
        },
      )
      const zipUrl = URL.createObjectURL(zipBlob)
      const zipName = `${slugify(project.name)}-nft-drop.zip`
      setLastZipUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return zipUrl
      })
      setLastZipName(zipName)
      const totalEditions = combos.length + oneOfOnes.length
      const oneOfOneMessage = oneOfOnes.length ? `, including ${oneOfOnes.length} unique 1/1${oneOfOnes.length === 1 ? '' : 's'}` : ''
      setStatus(`Done. ${totalEditions} ${output.label} images${oneOfOneMessage} and ${METADATA_FILE_NAME} are ready.`)
    } catch (error) {
      setStatus(getErrorMessage(error, 'Generation failed.'))
    } finally {
      setBusy(false)
    }
  }

  function updateProject(key, value) {
    setProject((current) => ({ ...current, [key]: value }))
  }

  function downloadProjectBackup() {
    if (!source) return

    const backup = buildProjectBackup(source, project)
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${slugify(project.name)}-project-backup.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Revoking synchronously can cancel an otherwise valid download in Safari.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setStatus('Project backup downloaded. Keep this JSON with your PSD.')
  }

  async function chooseProjectBackup() {
    if (!source || busy) return
    if (!(await ensureHolderAccess())) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.addEventListener(
      'change',
      async () => {
        const file = input.files?.[0]
        if (!file) return
        setBusy(true)
        setStatus('Restoring project backup...')
        try {
          const backup = JSON.parse(await file.text())
          const restored = restoreProjectBackup(source, backup)
          setProject(restored.project)
          setSource(restored.source)
          setSelectedCategoryIndex(0)
          setRuleDraft(emptyRuleDraft)
          setRuleFolderDraft(emptyRuleFolderDraft)
          setPositionRuleDraft(emptyPositionRuleDraft)
          setPositionRuleFolderDraft(emptyRuleFolderDraft)
          setConditionDraft(emptyConditionDraft)
          setFolderConflictDraft(emptyFolderConflictDraft)
          await renderPreview(restored.source)
          const skippedMessage = restored.skippedTraitCount
            ? ` Left ${restored.skippedTraitCount} new ${restored.skippedTraitCount === 1 ? 'trait' : 'traits'} unchanged.`
            : ''
          setStatus(`Restored settings for ${restored.traitCount} traits and ${restored.ruleCount} rules from ${file.name}.${skippedMessage}`)
        } catch (error) {
          setStatus(getErrorMessage(error, 'Could not restore that project backup.'))
        } finally {
          setBusy(false)
        }
      },
      { once: true },
    )
    input.click()
  }

  const traitOptionsByCategory = source?.categories?.map((category) =>
    category.traits.map((trait) => ({
      key: makeTraitKey(trait),
      label: `${category.name} / ${trait.name}`,
      traitLabel: trait.name,
    })),
  ) || []
  const traitOptions = traitOptionsByCategory.flat()
  const traitOptionMap = new Map(traitOptions.map((trait) => [trait.key, trait.label]))

  const incompatibilities = source?.incompatibilities || []
  const positionRules = source?.positionRules || []
  const categoryRequirements = source?.categoryRequirements || []
  const categoryConflicts = source?.categoryConflicts || []
  const categoryRequirementNames = new Set(categoryRequirements.map((rule) => rule.category))
  const pendingFolderRuleCount = conditionDraft.categories.filter((category) => !categoryRequirementNames.has(category)).length
  const existingFolderConflictKeys = new Set(categoryConflicts.map(makeRuleKey))
  const pendingFolderConflictKeys = new Set()
  for (const first of folderConflictDraft.first) {
    for (const second of folderConflictDraft.second) {
      if (first === second) continue
      const ruleKey = makeRuleKey({ first, second })
      if (!existingFolderConflictKeys.has(ruleKey)) pendingFolderConflictKeys.add(ruleKey)
    }
  }
  const pendingFolderConflictCount = pendingFolderConflictKeys.size
  const traitEditorCategory = selectedCategory || source?.categories?.[0] || null
  const traitEditorCategoryIndex = source?.categories?.length ? Math.min(selectedCategoryIndex, source.categories.length - 1) : 0
  const traitEditorTraitIndex = traitEditorCategory?.traits?.length ? Math.min(selectedTraitIndex, traitEditorCategory.traits.length - 1) : 0
  const traitEditorTrait = traitEditorCategory?.traits?.[traitEditorTraitIndex] || null
  const traitEditorNoneChance = getNormalizedNoneChance(traitEditorCategory)
  const traitEditorTraitChance = getNormalizedTraitChance(traitEditorCategory, traitEditorTrait)
  const totalTraitCount = source?.categories?.reduce((total, category) => total + category.traits.length, 0) || 0
  const positionFirstTrait = source ? findTraitByKey(source, positionRuleDraft.first) : null
  const positionSecondTrait = source ? findTraitByKey(source, positionRuleDraft.second) : null
  const positionFirstOptions = positionRuleFolderDraft.first === '' ? [] : traitOptionsByCategory[Number(positionRuleFolderDraft.first)] || []
  const positionSecondOptions = positionRuleFolderDraft.second === '' ? [] : traitOptionsByCategory[Number(positionRuleFolderDraft.second)] || []
  const positionPairTotal = positionFirstOptions.length * positionSecondOptions.length
  const positionPairNumber = positionRuleDraft.first && positionRuleDraft.second
    ? positionFirstOptions.findIndex((option) => option.key === positionRuleDraft.first) * positionSecondOptions.length +
      positionSecondOptions.findIndex((option) => option.key === positionRuleDraft.second) + 1
    : 0

  function getPositionCanvasTransform(side, trait) {
    if (!source || !trait) return 'none'
    const offsetX = Number(positionRuleDraft[`${side}X`]) || 0
    const offsetY = Number(positionRuleDraft[`${side}Y`]) || 0
    const deltaX = offsetX - getTraitOffset(trait, 'x')
    const deltaY = offsetY - getTraitOffset(trait, 'y')
    const scale = normalizeRuleScale(positionRuleDraft[`${side}Scale`]) / 100
    return `translate(${(deltaX / source.width) * 100}%, ${(deltaY / source.height) * 100}%) scale(${scale})`
  }

  return (
    <main className="app-shell" style={{ '--preview-background': previewBackground }}>
      <section className="topbar">
        <div>
          <p className="eyebrow">NFT trait combiner</p>
          <h1>Trait Forge</h1>
        </div>
        <div className="topbar-actions">
          <button className="help-action" type="button" onClick={() => setHelpOpen(true)}>
            <HelpCircle size={17} />
            Help
          </button>
          <div className="status-pill">
            {busy ? <Loader2 className="spin" size={17} /> : <CheckCircle2 size={17} />}
            <span>{status}</span>
          </div>
        </div>
      </section>

      <section className="workbench">
        <aside className="panel upload-panel">
          <h2>Sources</h2>
          <button
            className={`drop-button ${activeDropTarget === 'psd' ? 'drag-active' : ''}`}
            type="button"
            onClick={() => psdInputRef.current?.click()}
            onDragEnter={(event) => handleDropOver(event, 'psd')}
            onDragOver={(event) => handleDropOver(event, 'psd')}
            onDragLeave={(event) => handleDropLeave(event, 'psd')}
            onDrop={(event) => handleFileDrop(event, 'psd')}
            disabled={busy}
          >
            <Layers3 size={22} />
            <span>
              <strong>PSD / Procreate</strong>
              <small>Layered PSD or flattened Procreate preview.</small>
            </span>
          </button>
          <div className="split-row">
            <button
              className={`base-drop-button ${activeDropTarget === 'base' ? 'drag-active' : ''}`}
              type="button"
              onClick={() => baseInputRef.current?.click()}
              onDragEnter={(event) => handleDropOver(event, 'base')}
              onDragOver={(event) => handleDropOver(event, 'base')}
              onDragLeave={(event) => handleDropLeave(event, 'base')}
              onDrop={(event) => handleFileDrop(event, 'base')}
              disabled={busy}
            >
              <ImagePlus size={18} />
              <span>
                <strong>Base image</strong>
                <small>Drop or browse</small>
              </span>
            </button>
            <button type="button" onClick={() => folderInputRef.current?.click()} disabled={busy}>
              <FolderOpen size={18} />
              Trait folders
            </button>
          </div>
          {source && <section className="one-of-ones-panel" aria-label="Unique one of one artworks">
            <button
              className={`one-of-ones-drop ${activeDropTarget === 'one-of-ones' ? 'drag-active' : ''}`}
              type="button"
              onClick={() => oneOfOneInputRef.current?.click()}
              onDragEnter={(event) => handleDropOver(event, 'one-of-ones')}
              onDragOver={(event) => handleDropOver(event, 'one-of-ones')}
              onDragLeave={(event) => handleDropLeave(event, 'one-of-ones')}
              onDrop={handleOneOfOneDrop}
              disabled={busy || !source}
            >
              <ImagePlus size={19} />
              <span>
                <strong>1/1s folder</strong>
                <small>Drop complete artworks here. They never mix with traits.</small>
              </span>
              <b>{source?.oneOfOnes?.length || 0}</b>
            </button>
            {!!source?.oneOfOnes?.length && (
              <div className="one-of-ones-list">
                {source.oneOfOnes.map((artwork, index) => (
                  <div className="one-of-one-row" key={artwork.id}>
                    <OneOfOneThumbnail artwork={artwork} />
                    <label>
                      <span>1/1 trait name</span>
                      <input
                        value={artwork.name}
                        aria-label={`Name for 1/1 artwork ${index + 1}`}
                        onChange={(event) => renameOneOfOne(index, event.target.value)}
                      />
                    </label>
                    <button type="button" aria-label={`Remove ${getOneOfOneName(artwork)}`} onClick={() => deleteOneOfOne(index)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>}
          <button className="backup-action" type="button" onClick={chooseProjectBackup} disabled={busy || !source}>
            <Archive size={18} />
            Restore project backup
          </button>
          <p className="chance-note">Load the matching PSD, Procreate artwork, or trait folder first, then restore its JSON backup.</p>

          <input ref={psdInputRef} className="hidden" type="file" accept=".psd,.procreate,image/vnd.adobe.photoshop,application/x-procreate" onChange={handlePsdUpload} />
          <input ref={baseInputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp,.procreate,application/x-procreate" onChange={handleBaseUpload} />
          <input ref={folderInputRef} className="hidden" type="file" webkitdirectory="true" directory="" multiple onChange={handleFolderUpload} />
          <input ref={oneOfOneInputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp,.procreate,application/x-procreate" webkitdirectory="true" directory="" multiple onChange={handleOneOfOneUpload} />
          <input ref={traitFilesInputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp,.procreate,application/x-procreate" multiple onChange={handleTraitFilesUpload} />

          <div className="trait-list">
            <div className="list-header">
              <span>Render order</span>
              <div className="render-order-header-actions">
                <span>{formatComboCount(maxEditionsInfo)}</span>
                <button type="button" onClick={previewCurrentCombination} disabled={busy || !source}>
                  <Eye size={13} />
                  Preview
                </button>
                <button type="button" onClick={addCategory} disabled={busy || !source}>
                  <Plus size={13} />
                  Add folder
                </button>
              </div>
            </div>
            {sourceSummary.length ? (
              sourceSummary.map((item, index) => (
                <div
                  className={`trait-folder-group ${traitDropCategoryIndex === index ? 'drop-active' : ''}`}
                  key={`${item.name}-${index}`}
                  onDragOver={(event) => handleTraitFolderDragOver(event, index)}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setTraitDropCategoryIndex((current) => (current === index ? null : current))
                  }}
                  onDrop={(event) => handleTraitFolderDrop(event, index)}
                >
                  <div className={`trait-row ${item.enabled ? '' : 'disabled'} ${selectedCategoryIndex === index ? 'selected' : ''}`}>
                    {renderOrderRename?.categoryIndex === index ? (
                      <input
                        className="trait-rename-input"
                        value={renderOrderRename.value}
                        autoFocus
                        aria-label={`Rename ${item.name}`}
                        disabled={busy}
                        onChange={(event) => setRenderOrderRename((current) => ({ ...current, value: event.target.value }))}
                        onBlur={finishRenderOrderRename}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur()
                          if (event.key === 'Escape') setRenderOrderRename(null)
                        }}
                      />
                    ) : (
                      <button className="trait-select" type="button" aria-label={`Rename ${item.name}`} onClick={() => startRenderOrderRename(index)}>
                        <span title="Click to rename">{item.name}</span>
                        {!item.enabled && <small>Excluded</small>}
                      </button>
                    )}
                    <div className="trait-actions">
                      <strong>{item.enabled ? item.count : 0}/{item.total}</strong>
                      <button
                        className={expandedCategoryIndices.includes(index) ? 'active' : ''}
                        type="button"
                        aria-label={`${expandedCategoryIndices.includes(index) ? 'Hide' : 'Show'} traits in ${item.name}`}
                        aria-expanded={expandedCategoryIndices.includes(index)}
                        disabled={busy}
                        onClick={() => setExpandedCategoryIndices((current) => (
                          current.includes(index) ? current.filter((categoryIndex) => categoryIndex !== index) : [...current, index]
                        ))}
                      >
                        <Eye size={14} />
                      </button>
                      <button type="button" aria-label={`Move ${item.name} earlier`} disabled={busy || index === 0} onClick={() => moveCategory(index, -1)}>
                        <ArrowUp size={14} />
                      </button>
                      <button type="button" aria-label={`Move ${item.name} later`} disabled={busy || index === sourceSummary.length - 1} onClick={() => moveCategory(index, 1)}>
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={item.enabled ? `Remove ${item.name}` : `Restore ${item.name}`}
                        disabled={busy}
                        onClick={() => toggleCategory(index, !item.enabled)}
                      >
                        {item.enabled ? <X size={14} /> : <RotateCcw size={14} />}
                      </button>
                    </div>
                  </div>
                  {expandedCategoryIndices.includes(index) && (
                    <div className="folder-trait-list" aria-label={`Traits in ${item.name}`}>
                      {source.categories[index].traits.length ? source.categories[index].traits.map((trait, traitIndex) => (
                        <div
                          className="folder-trait-chip"
                          draggable={!busy}
                          onDragStart={(event) => startTraitFolderDrag(event, index, traitIndex)}
                          onDragEnd={finishTraitFolderDrag}
                          onClick={() => previewSingleTrait(index, traitIndex)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              previewSingleTrait(index, traitIndex)
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          title={`Drag ${getTraitMetadataName(trait)} to another folder`}
                          key={`${getTraitId(trait)}-${traitIndex}`}
                        >
                          <span>{getTraitMetadataName(trait)}</span>
                          <small>Drag to move</small>
                        </div>
                      )) : <p>This folder has no traits. Drag traits here from another folder.</p>}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="empty-state">Upload one layered PSD or Procreate artwork, or choose a base image and one directory containing trait folders.</p>
            )}
          </div>

          {source?.categories?.length && (
            <div className="compact-manager">
              <div className="chance-header">
                <span>
                  <SlidersHorizontal size={15} />
                  Trait editor
                </span>
                <strong>{totalTraitCount}</strong>
              </div>
              <button className="primary-action" type="button" disabled={busy} onClick={() => setTraitEditorOpen(true)}>
                <SlidersHorizontal size={16} />
                Open trait editor
              </button>
            </div>
          )}

          {source && (
            <div className="compact-manager">
              <div className="chance-header">
                <span>
                  <Ban size={15} />
                  Trait manager
                </span>
                <strong>{incompatibilities.length + positionRules.length + categoryRequirements.length + categoryConflicts.length}</strong>
              </div>
              <button
                className="primary-action"
                type="button"
                disabled={busy}
                onClick={() => {
                  setRuleDraft(emptyRuleDraft)
                  setRuleFolderDraft(emptyRuleFolderDraft)
                  setPositionRuleDraft(emptyPositionRuleDraft)
                  setPositionRuleFolderDraft(emptyRuleFolderDraft)
                  setTraitManagerOpen(true)
                }}
              >
                <Ban size={16} />
                Open trait manager
              </button>
              <p className="chance-note">Manage trait pairs, folder rules, and folder conflicts together.</p>
            </div>
          )}
        </aside>

        <section
          className={`preview-stage ${activeDropTarget === 'preview' ? 'drag-active' : ''}`}
          aria-label="Artwork preview and file drop area"
          onDragEnter={(event) => handleDropOver(event, 'preview')}
          onDragOver={(event) => handleDropOver(event, 'preview')}
          onDragLeave={(event) => handleDropLeave(event, 'preview')}
          onDrop={(event) => handleFileDrop(event, 'preview')}
        >
          {previewUrl ? (
            <img src={previewUrl} alt="Generated artwork preview" />
          ) : (
            <div className="preview-empty">
              <Upload size={36} />
              <span>Drop a PSD, Procreate file, or base image here.</span>
              <small>PNG, JPG, WebP, and Procreate are supported.</small>
            </div>
          )}
        </section>

        <aside className="panel settings-panel">
          <h2>Output</h2>
          <label>
            Collection name
            <input value={project.name} onChange={(event) => updateProject('name', event.target.value)} />
          </label>
          <label>
            Description
            <textarea value={project.description} rows="3" onChange={(event) => updateProject('description', event.target.value)} />
          </label>
          <label>
            Collection editions
            <input type="number" min="1" value={project.count} onChange={(event) => updateProject('count', event.target.value)} />
            <span className="field-hint">
              {maxEditionsInfo.approximate
                ? `${formatComboCount(maxEditionsInfo)} — live counting paused to keep editing fast.`
                : maxEditions
                  ? `${editionFormula} = ${formatComboCount(maxEditionsInfo)} possible combinations${oneOfOneCount ? `, plus ${oneOfOneCount} guaranteed 1/1${oneOfOneCount === 1 ? '' : 's'}.` : ''}`
                  : 'Load traits to calculate possible combinations.'}
            </span>
          </label>

          <div className="segmented three-up" aria-label="Output image format">
            {Object.entries(OUTPUT_FORMATS).map(([key, format]) => (
              <button className={project.outputFormat === key ? 'active' : ''} type="button" key={key} onClick={() => updateProject('outputFormat', key)}>
                {format.label}
              </button>
            ))}
          </div>

          {project.outputFormat !== 'png' && (
            <label>
              Quality
              <input type="range" min="50" max="95" value={Math.round(project.quality * 100)} onChange={(event) => updateProject('quality', Number(event.target.value) / 100)} />
              <span className="field-hint">{Math.round(project.quality * 100)}%</span>
            </label>
          )}

          <label>
            Maximum image size
            <input type="number" min="0" max="12000" value={project.maxDimension} onChange={(event) => updateProject('maxDimension', event.target.value)} />
            <span className="field-hint">
              {getOutputSizeHint(source, project)}
            </span>
          </label>

          <details className="advanced-settings">
            <summary>Advanced</summary>
            <div className="advanced-settings-content">
              <label>
                Canvas format
                <select value={project.canvasFormat} onChange={(event) => updateProject('canvasFormat', event.target.value)}>
                  {Object.entries(CANVAS_FORMATS).map(([key, format]) => (
                    <option key={key} value={key}>{format.label}</option>
                  ))}
                </select>
              </label>
              {project.canvasFormat === 'custom' && (
                <div className="ratio-inputs" aria-label="Custom canvas ratio">
                  <label>
                    Ratio width
                    <input type="number" min="1" max="100" value={project.customRatioWidth} onChange={(event) => updateProject('customRatioWidth', event.target.value)} />
                  </label>
                  <span aria-hidden="true">:</span>
                  <label>
                    Ratio height
                    <input type="number" min="1" max="100" value={project.customRatioHeight} onChange={(event) => updateProject('customRatioHeight', event.target.value)} />
                  </label>
                </div>
              )}
              {project.canvasFormat !== 'original' && (
                <>
                  <div className="segmented" aria-label="Artwork fit within canvas">
                    <button className={project.canvasFit === 'cover' ? 'active' : ''} type="button" onClick={() => updateProject('canvasFit', 'cover')}>
                      Fill & crop
                    </button>
                    <button className={project.canvasFit === 'contain' ? 'active' : ''} type="button" onClick={() => updateProject('canvasFit', 'contain')}>
                      Fit whole image
                    </button>
                  </div>
                  <span className="mode-hint">
                    {project.canvasFit === 'contain'
                      ? 'Keeps the whole artwork and adds transparent space when needed.'
                      : 'Fills the canvas and crops equally from opposite edges.'}
                  </span>
                </>
              )}
              <label>
                Image URI prefix
                <input value={project.imagePrefix} onChange={(event) => updateProject('imagePrefix', event.target.value)} />
              </label>
              <label>
                Random seed
                <input value={project.seed} onChange={(event) => updateProject('seed', event.target.value)} />
              </label>
              <div className="segmented" aria-label="Generation mode">
                <button className={project.mode === 'random' ? 'active' : ''} type="button" onClick={() => updateProject('mode', 'random')}>
                  <Shuffle size={16} />
                  Random sample
                </button>
                <button className={project.mode === 'all' ? 'active' : ''} type="button" onClick={() => updateProject('mode', 'all')}>
                  <Archive size={16} />
                  All in order
                </button>
              </div>
              <span className="mode-hint">
                {source && hasOrderedCategories(source.categories)
                  ? 'Folders set to “In order” always keep their sequence; other folders follow this generation mode.'
                  : project.mode === 'random'
                    ? 'Uses the seed to pick unique combinations.'
                    : 'Walks through every possible combination until Editions is reached.'}
              </span>
            </div>
          </details>

          <button className="sample-preview-action" type="button" onClick={generateSamplePreview} disabled={busy || !source}>
            {busy && samplePreviewOpen ? <Loader2 className="spin" size={18} /> : <Eye size={18} />}
            Preview {samplePreviewCount} {samplePreviewCount === 1 ? 'sample' : 'samples'}
          </button>

          <button className="primary-action" type="button" onClick={startGeneration} disabled={busy || !source}>
            {busy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
            {LOCAL_FREE_GENERATION
              ? 'Generate ZIP · Free local mode'
              : account.credits > 0
              ? `Generate ZIP · ${account.credits} credit${account.credits === 1 ? '' : 's'}`
              : 'Generate ZIP'}
          </button>

          <button className="download-link" type="button" onClick={downloadProjectBackup} disabled={busy || !source}>
            <Archive size={18} />
            Download project backup
          </button>

          {lastZipUrl && (
            <a className="download-link" href={lastZipUrl} download={lastZipName}>
              <Archive size={18} />
              Download {lastZipName}
            </a>
          )}
        </aside>
      </section>

      {introOpen && (
        <div className="modal-backdrop intro-backdrop" role="presentation">
          <section className="intro-modal" role="dialog" aria-modal="true" aria-labelledby="intro-title">
            <div className="intro-mark"><Layers3 size={30} /></div>
            <p className="eyebrow">Welcome to Trait Forge</p>
            <h2 id="intro-title">Build your upcoming NFT collection</h2>
            <p>
              This app was created to generate NFT collections. Mix traits, add rarities, create rules,
              and export images with metadata for your upcoming collection.
            </p>
            <div className="intro-price-note">
              {LOCAL_FREE_GENERATION
                ? 'Local development mode is free and does not require a generation code.'
                : 'ZIP generation uses one credit. Buy 3 credits for about $20 in USDC or ETH on Base, or pay $15 with a referral code. No wallet connection or registration is required.'}
            </div>
            <button className="primary-action" type="button" onClick={acceptIntro}>
              <CheckCircle2 size={18} />
              I understand and agree
            </button>
          </section>
        </div>
      )}

      {helpOpen && (
        <div className="modal-backdrop help-backdrop" role="presentation">
          <section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
            <header className="modal-header">
              <div>
                <p className="eyebrow">Guide and calculations</p>
                <h2 id="help-title">Trait Forge Help</h2>
              </div>
              <button type="button" aria-label="Close help" onClick={() => setHelpOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <div className="help-content">
              <section className="chance-formula-card">
                <div>
                  <HelpCircle size={21} />
                  <span>
                    <strong>How chances work</strong>
                    <small>Higher numbers appear more often. Lower numbers appear less often.</small>
                  </span>
                </div>
                <code>10 red tickets + 90 blue tickets = red appears about 10 times out of 100</code>
                <p>
                  Imagine putting tickets into a hat for every trait in a folder. A trait with a higher number gets more tickets, so it is picked more often. “No trait” is another ticket option that leaves the folder empty.
                </p>
                <p className="help-caveat">
                  Example: a 10% chance in a 1,000-image collection should appear about 100 times. The final number may be a little different because every generated image must be unique and follow your rules.
                </p>
              </section>

              <div className="help-faq" aria-label="Frequently asked questions">
                <details open>
                  <summary>What does “No trait chance” do?</summary>
                  <p>
                    It lets the generator leave this folder empty. At 0, a trait from the folder always appears. Raise the number to leave the folder empty more often. The “Estimated” line shows the chance Trait Forge calculates from all the numbers in that folder.
                  </p>
                </details>
                <details>
                  <summary>What does Smart Rarity do?</summary>
                  <p>
                    Smart Rarity gives you a balanced starting point automatically. It makes most traits fairly common, makes a small group rare, and avoids making one trait appear in almost every image.
                  </p>
                  <p>
                    For optional folders, it also adds a sensible “No trait” chance. Folders marked “Always” stay at 0%, so one of their traits appears in every image. You can change any of these numbers afterward.
                  </p>
                </details>
                <details>
                  <summary>What is the random seed?</summary>
                  <p>
                    It is like a shuffle code. Using the same code and settings gives you the same shuffled collection again. Change it when you want a different shuffle.
                  </p>
                </details>
                <details>
                  <summary>What do trait and folder rules do?</summary>
                  <p>
                    Rules tell Trait Forge which things are allowed together. Trait rules block a pair of individual traits. Folder rules show a folder only when a chosen trait is present. Folder conflicts stop two complete folders from appearing together. These rules can make the final trait counts slightly different from the estimated chances.
                  </p>
                </details>
                <details>
                  <summary>How are 1/1 artworks handled?</summary>
                  <p>
                    A 1/1 is a finished special artwork. It is added once, never mixed with other traits, and marked as a unique 1/1 in the metadata.
                  </p>
                </details>
                <details>
                  <summary>What do image size and canvas format control?</summary>
                  <p>
                    Maximum image size limits the longest exported side; enter 0 to keep the source resolution. Canvas format can preserve the original proportions or create square, portrait, landscape, story, and custom-ratio images. Use Fill &amp; crop for an edge-to-edge result or Fit whole image to keep all artwork visible.
                  </p>
                </details>
                <details>
                  <summary>How does the crypto payment work?</summary>
                  <p>
                    Choose USDC or ETH. Trait Forge shows you a payment address and a special amount close to $20, or close to $15 with a valid referral code. Send that exact amount using the Base network, then paste the transaction link or number. Trait Forge checks the public transaction and adds three generation credits to this browser. You do not need to connect a wallet or create an account.
                  </p>
                  <p>
                    For USDC, use official USDC on Base only. For ETH, send Base ETH. Keep the page open until the credits appear, because the payment request and credits belong to this browser.
                  </p>
                </details>
              </div>
            </div>
          </section>
        </div>
      )}

      {accessOpen && (
        <div className="modal-backdrop payment-backdrop" role="presentation">
          <section className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="access-title">
            <header className="modal-header">
              <div>
                <p className="eyebrow">No account or wallet connection</p>
                <h2 id="access-title">Get 3 generation credits</h2>
              </div>
              <button type="button" aria-label="Close generation access" disabled={accessBusy} onClick={() => setAccessOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <div className="payment-panel">
              <form className="payment-option-content" onSubmit={claimUsdcPayment}>
                <div className="payment-option-heading">
                  <span className="payment-option-icon"><CircleDollarSign size={25} /></span>
                  <div>
                    <h3>Pay {paymentQuote?.referralCode ? '$15' : '$20'} on Base: USDC/ETH</h3>
                    <p>Send from any wallet, then paste the transaction below. Base only.</p>
                  </div>
                </div>
                <div className="payment-asset-picker" aria-label="Choose payment asset">
                  {['USDC', 'ETH'].map((asset) => (
                    <button
                      className={paymentAsset === asset ? 'active' : ''}
                      type="button"
                      disabled={accessBusy}
                      aria-pressed={paymentAsset === asset}
                      key={asset}
                      onClick={() => loadPaymentQuote(asset)}
                    >
                      {asset === 'USDC' ? 'USDC on Base' : 'ETH on Base'}
                    </button>
                  ))}
                </div>
                <div className="payment-network-note">
                  <strong>Base network · {paymentAsset === 'USDC' ? 'official USDC only' : 'native ETH only'}</strong>
                  <span>{paymentAsset === 'USDC' ? 'Do not send ETH, bridged USDC, or tokens from another network.' : 'Do not send ETH from Ethereum mainnet or another network.'} Keep this browser open until credits are added. Crypto payments cannot be reversed.</span>
                </div>

                <div className="referral-code-field">
                  <label>
                    Referral code <span>optional · save $5</span>
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="Enter referral code"
                      value={referralCode}
                      disabled={accessBusy}
                      onChange={(event) => {
                        setReferralCode(event.target.value.toLowerCase())
                        setPaymentQuote(null)
                        setPaymentTransaction('')
                        setAccessMessage('')
                      }}
                    />
                  </label>
                  {paymentQuote?.referralCode && (
                    <p><CheckCircle2 size={14} /> Code <strong>{paymentQuote.referralCode}</strong> applied — you save $5.</p>
                  )}
                </div>

                {paymentQuote ? (
                  <>
                    <ol className="crypto-payment-steps">
                      <li>Copy the exact {paymentQuote.asset} amount and payment address.</li>
                      <li>Send it on the <strong>Base</strong> network from any wallet.</li>
                      <li>Paste the transaction hash or explorer link and verify.</li>
                    </ol>
                    <div className="payment-copy-field">
                      <span>Exact amount</span>
                      <div>
                        <code>{paymentQuote.amount} {paymentQuote.asset}</code>
                        <button type="button" aria-label={`Copy exact ${paymentQuote.asset} amount`} onClick={() => copyPaymentValue('Amount', paymentQuote.amount)}>
                          <Copy size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="payment-copy-field">
                      <span>Payment address</span>
                      <div>
                        <code>{paymentQuote.recipientAddress}</code>
                        <button type="button" aria-label="Copy payment address" onClick={() => copyPaymentValue('Payment address', paymentQuote.recipientAddress)}>
                          <Copy size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="payment-quote-meta">
                      <span>Quote expires {new Date(paymentQuote.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <a href={`${paymentQuote.explorerUrl}/address/${paymentQuote.recipientAddress}`} target="_blank" rel="noreferrer">
                        View address <ExternalLink size={12} />
                      </a>
                    </div>
                    <label>
                      Base transaction hash or link
                      <input
                        type="text"
                        autoComplete="off"
                        placeholder="0x… or https://base.blockscout.com/tx/…"
                        value={paymentTransaction}
                        disabled={accessBusy}
                        onChange={(event) => setPaymentTransaction(event.target.value)}
                      />
                    </label>
                    <button className="primary-action" type="submit" disabled={accessBusy || !paymentTransaction.trim()}>
                      {accessBusy ? <Loader2 className="spin" size={18} /> : <CheckCircle2 size={18} />}
                      Verify payment and generate
                    </button>
                  </>
                ) : (
                  <button className="primary-action" type="button" disabled={accessBusy} onClick={() => loadPaymentQuote(paymentAsset)}>
                    {accessBusy ? <Loader2 className="spin" size={18} /> : <CircleDollarSign size={18} />}
                    Prepare payment
                  </button>
                )}
              </form>

              <details className="code-redemption" open>
                <summary>I have a generation code</summary>
                <form className="payment-option-content" onSubmit={redeemGenerationCode}>
                  <label>
                    Generation code
                    <input type="text" autoComplete="off" placeholder="TF-…" value={generationCode} disabled={accessBusy} onChange={(event) => setGenerationCode(event.target.value)} />
                  </label>
                  <button type="submit" disabled={accessBusy || !generationCode.trim()}>
                    <KeyRound size={16} />
                    Apply code and generate
                  </button>
                </form>
              </details>
              {accessMessage && <p className="payment-message" aria-live="polite">{accessMessage}</p>}
              <aside className="payment-support-note" aria-label="Payment support">
                <strong>Having trouble with your payment?</strong>
                <span>
                  In case of any problems, DM: <a href="https://x.com/nickvrnn" target="_blank" rel="noreferrer">@nickvrnn</a>
                </span>
                <a className="payment-comment-link" href="https://x.com/nickvrnn/status/2092216826596065296?s=20" target="_blank" rel="noreferrer">
                  Leave a comment under this post
                </a>
              </aside>
            </div>
          </section>
        </div>
      )}

      {samplePreviewOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="sample-preview-modal" role="dialog" aria-modal="true" aria-label="Collection sample preview">
            <header className="modal-header">
              <div>
                <p className="eyebrow">Before ZIP generation</p>
                <h2>Collection samples</h2>
              </div>
              <button type="button" aria-label="Close sample preview" disabled={busy || gifBusy} onClick={closeSamplePreview}>
                <X size={18} />
              </button>
            </header>
            {samplePreviews.length ? (
              <div className="sample-preview-grid">
                {samplePreviews.map((preview) => (
                  <figure key={preview.url} title={preview.traits.join('\n')}>
                    <div style={{ '--preview-background': previewBackground }}>
                      <img src={preview.url} alt={`Sample artwork ${preview.edition}`} />
                    </div>
                    <figcaption>#{preview.edition}</figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <div className="sample-preview-loading">
                <Loader2 className="spin" size={28} />
                <span>Building sample combinations…</span>
              </div>
            )}
            <footer className="sample-preview-footer">
              {isMobileShareDevice ? (
                <span>Shares the collage image and composed message through your mobile share sheet.</span>
              ) : (
                <div className="sample-preview-share-instruction">
                  <span>After the X composer opens, paste the collage:</span>
                  <strong><kbd>{pasteModifier}</kbd><b>+</b><kbd>V</kbd></strong>
                </div>
              )}
              <div className="sample-preview-footer-actions">
                <label>
                  GIF frames
                  <select value={gifFrameCount} disabled={gifBusy || samplePreviews.length < 5} onChange={(event) => setGifFrameCount(Number(event.target.value))}>
                    {[5, 6, 7].filter((count) => count <= samplePreviews.length).map((count) => (
                      <option value={count} key={count}>{count}</option>
                    ))}
                  </select>
                </label>
                <button className="gif-preview-action" type="button" disabled={gifBusy || samplePreviews.length < 5} onClick={generatePreviewGif}>
                  {gifBusy ? <Loader2 className="spin" size={16} /> : <Film size={16} />}
                  {gifBusy ? 'Generating GIF…' : 'Generate GIF'}
                </button>
                <button type="button" disabled={!sampleCollage || busy} onClick={shareSampleCollage}>
                  <Share2 size={16} />
                  Share {sampleCollage?.count || 8}-item collage to X
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {traitEditorOpen && source?.categories?.length && (
        <div className="modal-backdrop" role="presentation">
          <section className="trait-editor-modal" role="dialog" aria-modal="true" aria-label="Trait editor">
            <header className="modal-header">
              <div>
                <p className="eyebrow">Trait metadata</p>
                <h2>Trait editor</h2>
              </div>
              <div className="modal-header-actions">
                <button className="modal-faq-action" type="button" onClick={() => setHelpOpen(true)}>
                  <HelpCircle size={16} />
                  FAQ
                </button>
                <button
                  className="modal-add-traits-action"
                  type="button"
                  disabled={busy || !traitEditorCategory}
                  onClick={() => chooseTraitFiles(traitEditorCategoryIndex)}
                >
                  <ImagePlus size={16} />
                  Add traits
                </button>
                <button className="modal-rarity-action" type="button" disabled={busy} onClick={openRarityPlanner}>
                  <Shuffle size={16} />
                  Randomize rarities
                </button>
                <button type="button" aria-label="Close trait editor" onClick={() => setTraitEditorOpen(false)}>
                  <X size={18} />
                </button>
              </div>
            </header>
            <div className="trait-editor-workspace">
              <nav className="trait-editor-nav" aria-label="Trait folders">
                <div className="editor-column-label">Folders</div>
                <div className="trait-editor-folder-list">
                  {source.categories.map((category, categoryIndex) => (
                    <button
                      className={traitEditorCategoryIndex === categoryIndex ? 'active' : ''}
                      type="button"
                      key={`${category.name}-${categoryIndex}`}
                      onClick={() => {
                        setSelectedCategoryIndex(categoryIndex)
                        setSelectedTraitIndex(0)
                      }}
                    >
                      <span>{category.name}</span>
                      <strong>{category.traits.length}</strong>
                    </button>
                  ))}
                </div>
                {traitEditorCategory && (
                  <div className="trait-folder-settings">
                    <label>
                      Folder name
                      <input
                        value={traitEditorCategory.name}
                        disabled={busy || traitEditorCategory.enabled === false}
                        onChange={(event) => renameCategory(traitEditorCategoryIndex, event.target.value)}
                      />
                    </label>
                  </div>
                )}
              </nav>

              <section className="trait-editor-list" aria-label="Traits in selected folder">
                <header className="trait-editor-list-header">
                  <div className="selected-folder-heading">
                    <p className="eyebrow">Selected folder</p>
                    <div className="selected-folder-title-row">
                      <h3>{traitEditorCategory?.name}</h3>
                      <span>{traitEditorCategory?.traits.length || 0} traits</span>
                    </div>
                  </div>
                  <div className="selected-folder-controls">
                    <label className="folder-selection-mode">
                      Distribution
                      <select
                        value={getCategorySelectionMode(traitEditorCategory)}
                        disabled={busy || traitEditorCategory?.enabled === false}
                        onChange={(event) => updateCategorySelectionMode(traitEditorCategoryIndex, event.target.value)}
                      >
                        <option value="weighted">Weighted mix</option>
                        <option value="ordered">In order · 1 → last</option>
                      </select>
                      <small>
                        {getCategorySelectionMode(traitEditorCategory) === 'ordered'
                          ? 'Every trait appears once in folder order before the sequence repeats.'
                          : 'Traits mix according to their individual chance settings.'}
                      </small>
                    </label>
                    <div className="folder-none-chance">
                      <div className="chance-label-row">
                        <label htmlFor="folder-none-chance-input">No trait chance</label>
                        <button
                          className="feature-tooltip"
                          type="button"
                          aria-label="Explain no trait chance"
                          data-tooltip="How often this folder should be left empty. Click for a simple example."
                          onClick={() => setHelpOpen(true)}
                        >
                          <HelpCircle size={13} />
                        </button>
                      </div>
                      <div className="input-with-suffix">
                        <CommittedDecimalInput
                          key={`none-weight-${traitEditorCategoryIndex}`}
                          id="folder-none-chance-input"
                          min="0"
                          max="100"
                          value={getCategoryNoneWeight(traitEditorCategory)}
                          disabled={busy || traitEditorCategory?.enabled === false || getCategorySelectionMode(traitEditorCategory) === 'ordered'}
                          aria-label={`No trait chance for ${traitEditorCategory?.name || 'folder'}`}
                          onCommit={(value) => updateCategoryNoneWeight(traitEditorCategoryIndex, value)}
                        />
                        <span>%</span>
                      </div>
                      <small>Estimated: {formatChance(traitEditorNoneChance)} of images</small>
                    </div>
                  </div>
                </header>
                <div className="trait-editor-list-scroll">
                  {traitEditorCategory?.traits.map((trait, traitIndex) => (
                    <button
                      className={`trait-editor-list-item ${traitEditorTraitIndex === traitIndex ? 'active' : ''}`}
                      type="button"
                      key={`${getTraitId(trait)}-${traitIndex}`}
                      onClick={() => setSelectedTraitIndex(traitIndex)}
                    >
                      <span>{getTraitMetadataName(trait)}</span>
                      <small>
                        {getCategorySelectionMode(traitEditorCategory) === 'ordered'
                          ? `Sequence #${traitIndex + 1}`
                          : `Estimated chance ${formatChance(getNormalizedTraitChance(traitEditorCategory, trait))}`}
                        {' · '}Position X {getTraitOffset(trait, 'x')} · Y {getTraitOffset(trait, 'y')}
                      </small>
                    </button>
                  ))}
                </div>
              </section>

              <aside className="trait-editor-inspector" aria-label="Selected trait inspector">
                {traitEditorTrait ? (
                  <>
                    <header className="trait-inspector-header">
                      <p className="eyebrow">Selected trait</p>
                      {traitTitleEditing ? (
                        <input
                          className="trait-title-input"
                          value={traitEditorTrait.name}
                          autoFocus
                          disabled={busy || traitEditorCategory.enabled === false}
                          aria-label="Edit selected trait name"
                          onChange={(event) => renameTrait(traitEditorCategoryIndex, traitEditorTraitIndex, event.target.value)}
                          onBlur={() => setTraitTitleEditing(false)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur()
                          }}
                        />
                      ) : (
                        <button className="trait-title-button" type="button" disabled={busy || traitEditorCategory.enabled === false} onClick={() => setTraitTitleEditing(true)}>
                          {getTraitMetadataName(traitEditorTrait)}
                        </button>
                      )}
                    </header>
                    <div className="preview-background-setting trait-editor-background-setting">
                      <span>Preview background</span>
                      <div className="preview-background-options" role="group" aria-label="Preview background color">
                        {PREVIEW_BACKGROUNDS.map((color) => (
                          <button
                            className={previewBackground.toLowerCase() === color ? 'active' : ''}
                            type="button"
                            aria-label={`Use ${color} preview background`}
                            title={color}
                            style={{ '--swatch-color': color }}
                            onClick={() => setPreviewBackground(color)}
                            key={color}
                          />
                        ))}
                        <label className="preview-color-custom" title="Custom preview background">
                          <input
                            type="color"
                            value={previewBackground}
                            aria-label="Custom preview background color"
                            onChange={(event) => setPreviewBackground(event.target.value)}
                          />
                        </label>
                      </div>
                      <small>Preview only. Exported images are unchanged.</small>
                    </div>
                    <div
                      className="trait-inspector-preview"
                      onPointerDown={(event) => handleTraitPreviewPointerDown(event, traitEditorTrait)}
                      onPointerMove={handleTraitPreviewPointerMove}
                      onPointerUp={handleTraitPreviewPointerUp}
                      onPointerCancel={handleTraitPreviewPointerUp}
                    >
                      {traitEditorPreviewUrl ? (
                        <img src={traitEditorPreviewUrl} alt={`${getTraitMetadataName(traitEditorTrait)} positioned preview`} draggable="false" />
                      ) : (
                        <Loader2 className="spin" size={24} aria-label="Refreshing trait preview" />
                      )}
                      <span>Drag artwork to reposition</span>
                    </div>
                    <div className="trait-inspector-form">
                      <label>
                        Name in metadata
                        <input
                          value={traitEditorTrait.name}
                          disabled={busy || traitEditorCategory.enabled === false}
                          onChange={(event) => renameTrait(traitEditorCategoryIndex, traitEditorTraitIndex, event.target.value)}
                        />
                      </label>
                      <div className="trait-chance-field">
                        <div className="chance-label-row">
                          <label htmlFor="selected-trait-chance-input">Chance setting</label>
                          <button
                            className="feature-tooltip"
                            type="button"
                            aria-label="Explain trait chance"
                            data-tooltip="Higher numbers appear more often. Lower numbers appear less often. Click for a simple example."
                            onClick={() => setHelpOpen(true)}
                          >
                            <HelpCircle size={13} />
                          </button>
                        </div>
                        <div className="input-with-suffix">
                          <CommittedDecimalInput
                            key={`trait-weight-${getTraitId(traitEditorTrait)}`}
                            id="selected-trait-chance-input"
                            min="0"
                            max="100"
                            value={traitEditorTrait.weight ?? 1}
                            disabled={busy || traitEditorCategory.enabled === false || getCategorySelectionMode(traitEditorCategory) === 'ordered'}
                            aria-label={`Chance setting for ${getTraitMetadataName(traitEditorTrait)}`}
                            onCommit={(value) => updateTraitWeight(traitEditorCategoryIndex, traitEditorTraitIndex, value)}
                          />
                          <span>%</span>
                        </div>
                        <small>
                          {getCategorySelectionMode(traitEditorCategory) === 'ordered'
                            ? `Sequence position ${traitEditorTraitIndex + 1} of ${traitEditorCategory.traits.length}`
                            : `Estimated chance: ${formatChance(traitEditorTraitChance)}`}
                        </small>
                      </div>
                      <div className="trait-inspector-position">
                        <div className="position-title">
                          <span>Position</span>
                          <button type="button" disabled={busy} onClick={() => updateTraitPositionPair(makeTraitKey(traitEditorTrait), 0, 0)}>Reset</button>
                        </div>
                        <div className="position-axis-grid">
                          <label>
                            X
                            <input type="number" step="1" value={getTraitOffset(traitEditorTrait, 'x')} disabled={busy} onChange={(event) => updateTraitPosition(makeTraitKey(traitEditorTrait), 'x', event.target.value)} />
                          </label>
                          <label>
                            Y
                            <input type="number" step="1" value={getTraitOffset(traitEditorTrait, 'y')} disabled={busy} onChange={(event) => updateTraitPosition(makeTraitKey(traitEditorTrait), 'y', event.target.value)} />
                          </label>
                        </div>
                      </div>
                      <label>
                        Move to folder
                        <select
                          value=""
                          disabled={busy || source.categories.length < 2}
                          onChange={(event) => moveTraitToCategory(traitEditorCategoryIndex, traitEditorTraitIndex, Number(event.target.value))}
                        >
                          <option value="">Choose folder</option>
                          {source.categories.map((category, categoryIndex) => categoryIndex !== traitEditorCategoryIndex && (
                            <option value={categoryIndex} key={`${category.name}-${categoryIndex}`}>{category.name}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="trait-delete-action"
                        type="button"
                        disabled={busy}
                        onClick={() => deleteTrait(traitEditorCategoryIndex, traitEditorTraitIndex)}
                      >
                        <Trash2 size={16} />
                        Delete trait
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="trait-inspector-empty">Choose a trait to edit it.</div>
                )}
              </aside>
            </div>
          </section>
        </div>
      )}

      {rarityPlanner.open && source?.categories?.length && (
        <div className="modal-backdrop rarity-planner-backdrop" role="presentation">
          <section className="rarity-planner-modal" role="dialog" aria-modal="true" aria-labelledby="rarity-planner-title">
            <header className="modal-header">
              <div>
                <p className="eyebrow">Smart rarity setup</p>
                <h2 id="rarity-planner-title">Randomize rarities</h2>
              </div>
              <button type="button" aria-label="Close rarity setup" disabled={busy} onClick={() => setRarityPlanner((current) => ({ ...current, open: false }))}>
                <X size={18} />
              </button>
            </header>
            <form className="rarity-planner-form" onSubmit={randomizeTraitRarities}>
              <label className="rarity-supply-field">
                Collection supply
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={rarityPlanner.supply}
                  disabled={busy}
                  onChange={(event) => setRarityPlanner((current) => ({ ...current, supply: event.target.value }))}
                />
                <small>Rarity percentages and expected copy counts will be tuned for this supply.</small>
              </label>

              <fieldset className="rarity-group-picker">
                <legend>Folders with 0% “No trait” chance</legend>
                <p>Checked folders always appear. Unchecked folders are optional and receive a recommended “No trait” chance.</p>
                <div className="rarity-group-options">
                  {source.categories.map((category, categoryIndex) => (
                    <label className="rarity-group-option" key={`${category.name}-${categoryIndex}`}>
                      <input
                        type="checkbox"
                        checked={rarityPlanner.zeroNoneCategoryIndexes.includes(categoryIndex)}
                        disabled={busy || category.enabled === false || !category.traits.length}
                        onChange={() => toggleRarityZeroNoneCategory(categoryIndex)}
                      />
                      <span>
                        <strong>{category.name}</strong>
                        <small>{category.traits.length} traits{category.enabled === false ? ' · excluded' : ''}</small>
                      </span>
                      <b>{rarityPlanner.zeroNoneCategoryIndexes.includes(categoryIndex) ? 'Always' : 'Optional'}</b>
                    </label>
                  ))}
                </div>
              </fieldset>

              <footer className="rarity-planner-actions">
                <button type="button" disabled={busy} onClick={() => setRarityPlanner((current) => ({ ...current, open: false }))}>Cancel</button>
                <button className="primary-action" type="submit" disabled={busy}>
                  <Shuffle size={16} />
                  Apply random rarities
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {traitManagerOpen && source && (
        <div className="modal-backdrop" role="presentation">
          <section className="rule-manager-modal" role="dialog" aria-modal="true" aria-label="Trait manager">
            <header className="modal-header">
              <div>
                <p className="eyebrow">Collection compatibility</p>
                <h2>Trait manager</h2>
              </div>
              <button type="button" aria-label="Close trait manager" onClick={() => setTraitManagerOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <nav className="rule-manager-tabs" aria-label="Trait manager sections">
              <button
                className={activeRuleManagerTab === 'trait-pairs' ? 'active' : ''}
                type="button"
                aria-current={activeRuleManagerTab === 'trait-pairs' ? 'page' : undefined}
                onClick={() => setActiveRuleManagerTab('trait-pairs')}
              >
                <Ban size={16} />
                <span>Trait pairs</span>
                <strong>{incompatibilities.length}</strong>
              </button>
              <button
                className={activeRuleManagerTab === 'positions' ? 'active' : ''}
                type="button"
                aria-current={activeRuleManagerTab === 'positions' ? 'page' : undefined}
                onClick={() => setActiveRuleManagerTab('positions')}
              >
                <SlidersHorizontal size={16} />
                <span>Positions</span>
                <strong>{positionRules.length}</strong>
              </button>
              <button
                className={activeRuleManagerTab === 'folder-rules' ? 'active' : ''}
                type="button"
                aria-current={activeRuleManagerTab === 'folder-rules' ? 'page' : undefined}
                onClick={() => setActiveRuleManagerTab('folder-rules')}
              >
                <FolderOpen size={16} />
                <span>Folder rules</span>
                <strong>{categoryRequirements.length}</strong>
              </button>
              <button
                className={activeRuleManagerTab === 'folder-conflicts' ? 'active' : ''}
                type="button"
                aria-current={activeRuleManagerTab === 'folder-conflicts' ? 'page' : undefined}
                onClick={() => setActiveRuleManagerTab('folder-conflicts')}
              >
                <Layers3 size={16} />
                <span>Folder conflicts</span>
                <strong>{categoryConflicts.length}</strong>
              </button>
            </nav>
            <div className="rule-manager-grid">
              {activeRuleManagerTab === 'trait-pairs' && (
              <section className="rule-manager-section">
                <div className="rule-manager-title">
                  <span>
                    <Ban size={16} />
                    Trait pairs
                  </span>
                  <strong>{incompatibilities.length}</strong>
                </div>
                <p>Select two individual traits that must never appear together.</p>
                <div className="trait-picker-field">
                  <label>
                    Folder
                    <select
                      value={ruleFolderDraft.first}
                      disabled={busy}
                      onChange={(event) => {
                        setRuleFolderDraft((current) => ({ ...current, first: event.target.value }))
                        setRuleDraft((current) => ({ ...current, first: '' }))
                      }}
                    >
                      <option value="">Choose folder</option>
                      {source.categories.map((category, categoryIndex) => (
                        <option value={categoryIndex} key={`${category.name}-${categoryIndex}`}>{category.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    First trait
                    <select value={ruleDraft.first} disabled={busy || ruleFolderDraft.first === ''} onChange={(event) => setRuleDraft((current) => ({ ...current, first: event.target.value }))}>
                      <option value="">Choose trait</option>
                      {(ruleFolderDraft.first === '' ? [] : traitOptionsByCategory[Number(ruleFolderDraft.first)] || []).map((trait) => <option value={trait.key} key={trait.key}>{trait.traitLabel}</option>)}
                    </select>
                  </label>
                  <ManagerTraitPreview traitKey={ruleDraft.first} url={managerPreviewUrls[ruleDraft.first]} label={traitOptionMap.get(ruleDraft.first)} />
                </div>
                <div className="trait-picker-field">
                  <label>
                    Folder
                    <select
                      value={ruleFolderDraft.second}
                      disabled={busy}
                      onChange={(event) => {
                        setRuleFolderDraft((current) => ({ ...current, second: event.target.value }))
                        setRuleDraft((current) => ({ ...current, second: '' }))
                      }}
                    >
                      <option value="">Choose folder</option>
                      {source.categories.map((category, categoryIndex) => (
                        <option value={categoryIndex} key={`${category.name}-${categoryIndex}`}>{category.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Cannot appear with
                    <select value={ruleDraft.second} disabled={busy || ruleFolderDraft.second === ''} onChange={(event) => setRuleDraft((current) => ({ ...current, second: event.target.value }))}>
                      <option value="">Choose trait</option>
                      {(ruleFolderDraft.second === '' ? [] : traitOptionsByCategory[Number(ruleFolderDraft.second)] || []).map((trait) => <option value={trait.key} key={trait.key}>{trait.traitLabel}</option>)}
                    </select>
                  </label>
                  <ManagerTraitPreview traitKey={ruleDraft.second} url={managerPreviewUrls[ruleDraft.second]} label={traitOptionMap.get(ruleDraft.second)} />
                </div>
                {ruleDraft.first && ruleDraft.second && (
                  <div className="pair-position-preview">
                    <div className="pair-position-preview-header">
                      <span>Selected pair preview</span>
                      <small>Confirm the selected traits before adding the rule</small>
                    </div>
                    <div className="pair-position-preview-frame">
                      {managerPairPreviewUrl ? (
                        <img src={managerPairPreviewUrl} alt="Combined selected trait pair preview" />
                      ) : (
                        <Loader2 className="spin" size={22} aria-label="Loading pair preview" />
                      )}
                    </div>
                  </div>
                )}
                <button className="rule-add" type="button" disabled={busy || !ruleDraft.first || !ruleDraft.second || ruleDraft.first === ruleDraft.second} onClick={addIncompatibility}>
                  <Ban size={16} />
                  Add trait rule
                </button>
                {incompatibilities.length ? (
                  <div className="rule-list">
                    {incompatibilities.map((rule, index) => (
                      <div className="rule-row visual-rule-row" key={makeRuleKey(rule)}>
                        <div className="rule-visuals">
                          <ManagerRuleTraitPreview url={managerPreviewUrls[rule.first]} label={traitOptionMap.get(rule.first)} />
                          <span>cannot appear with</span>
                          <ManagerRuleTraitPreview url={managerPreviewUrls[rule.second]} label={traitOptionMap.get(rule.second)} />
                        </div>
                        <button type="button" disabled={busy} aria-label={`Remove rule ${formatRule(rule, traitOptionMap)}`} onClick={() => removeIncompatibility(index)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : <p className="manager-empty">No trait-pair rules yet.</p>}
              </section>
              )}

              {activeRuleManagerTab === 'positions' && (
              <section className="rule-manager-section position-manager-section">
                <div className="rule-manager-title">
                  <span>
                    <SlidersHorizontal size={16} />
                    Position manager
                  </span>
                  <strong>{positionRules.length}</strong>
                </div>
                <p>Choose two folders once. The first pair is selected automatically, and Save &amp; continue walks through every pair for you.</p>
                <div className="trait-picker-field">
                  <label>
                    First folder
                    <select
                      value={positionRuleFolderDraft.first}
                      disabled={busy}
                      onChange={(event) => selectPositionRuleFolder('first', event.target.value)}
                    >
                      <option value="">Choose folder</option>
                      {source.categories.map((category, categoryIndex) => (
                        <option value={categoryIndex} disabled={String(categoryIndex) === positionRuleFolderDraft.second} key={`${category.name}-${categoryIndex}`}>{category.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    First trait <small className="optional-field-note">Optional jump</small>
                    <select
                      value={positionRuleDraft.first}
                      disabled={busy || positionRuleFolderDraft.first === ''}
                      onChange={(event) => selectPositionRuleTrait('first', event.target.value)}
                    >
                      <option value="">Choose trait</option>
                      {(positionRuleFolderDraft.first === '' ? [] : traitOptionsByCategory[Number(positionRuleFolderDraft.first)] || []).map((trait) => (
                        <option value={trait.key} key={trait.key}>{trait.traitLabel}</option>
                      ))}
                    </select>
                  </label>
                  <ManagerTraitPreview traitKey={positionRuleDraft.first} url={managerPreviewUrls[positionRuleDraft.first]} label={traitOptionMap.get(positionRuleDraft.first)} />
                  <PairPositionDraftControls
                    traitKey={positionRuleDraft.first}
                    label={traitOptionMap.get(positionRuleDraft.first)}
                    offsetX={positionRuleDraft.firstX}
                    offsetY={positionRuleDraft.firstY}
                    scale={positionRuleDraft.firstScale}
                    onChange={(axis, value) => updatePositionRuleOffset('first', axis, value)}
                    onScaleChange={(value) => updatePositionRuleScale('first', value)}
                  />
                </div>
                <div className="trait-picker-field">
                  <label>
                    Second folder
                    <select
                      value={positionRuleFolderDraft.second}
                      disabled={busy}
                      onChange={(event) => selectPositionRuleFolder('second', event.target.value)}
                    >
                      <option value="">Choose folder</option>
                      {source.categories.map((category, categoryIndex) => (
                        <option value={categoryIndex} disabled={String(categoryIndex) === positionRuleFolderDraft.first} key={`${category.name}-${categoryIndex}`}>{category.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Second trait <small className="optional-field-note">Optional jump</small>
                    <select
                      value={positionRuleDraft.second}
                      disabled={busy || positionRuleFolderDraft.second === ''}
                      onChange={(event) => selectPositionRuleTrait('second', event.target.value)}
                    >
                      <option value="">Choose trait</option>
                      {(positionRuleFolderDraft.second === '' ? [] : traitOptionsByCategory[Number(positionRuleFolderDraft.second)] || []).map((trait) => (
                        <option value={trait.key} key={trait.key}>{trait.traitLabel}</option>
                      ))}
                    </select>
                  </label>
                  <ManagerTraitPreview traitKey={positionRuleDraft.second} url={managerPreviewUrls[positionRuleDraft.second]} label={traitOptionMap.get(positionRuleDraft.second)} />
                  <PairPositionDraftControls
                    traitKey={positionRuleDraft.second}
                    label={traitOptionMap.get(positionRuleDraft.second)}
                    offsetX={positionRuleDraft.secondX}
                    offsetY={positionRuleDraft.secondY}
                    scale={positionRuleDraft.secondScale}
                    onChange={(axis, value) => updatePositionRuleOffset('second', axis, value)}
                    onScaleChange={(value) => updatePositionRuleScale('second', value)}
                  />
                </div>
                {positionRuleDraft.first && positionRuleDraft.second && (
                  <div className="pair-position-preview interactive-position-preview">
                    <div className="pair-position-preview-header">
                      <span>Pair {Math.max(1, positionPairNumber)} of {positionPairTotal}</span>
                      <small>Click a trait below, then drag it in the canvas</small>
                    </div>
                    <div className="position-preview-trait-tabs" role="group" aria-label="Trait to reposition">
                      <button
                        className={activePositionTraitSide === 'first' ? 'active' : ''}
                        type="button"
                        onClick={() => setActivePositionTraitSide('first')}
                      >
                        <span>First trait</span>
                        <strong>{traitOptionMap.get(positionRuleDraft.first)?.split(' / ').at(-1)}</strong>
                        <small>X {Number(positionRuleDraft.firstX) || 0} · Y {Number(positionRuleDraft.firstY) || 0} · {normalizeRuleScale(positionRuleDraft.firstScale)}%</small>
                      </button>
                      <button
                        className={activePositionTraitSide === 'second' ? 'active' : ''}
                        type="button"
                        onClick={() => setActivePositionTraitSide('second')}
                      >
                        <span>Second trait</span>
                        <strong>{traitOptionMap.get(positionRuleDraft.second)?.split(' / ').at(-1)}</strong>
                        <small>X {Number(positionRuleDraft.secondX) || 0} · Y {Number(positionRuleDraft.secondY) || 0} · {normalizeRuleScale(positionRuleDraft.secondScale)}%</small>
                      </button>
                    </div>
                    <div
                      className="pair-position-preview-frame interactive"
                      aria-label={`Drag ${activePositionTraitSide} trait to reposition it`}
                      onPointerDown={handlePositionCanvasPointerDown}
                      onPointerMove={handlePositionCanvasPointerMove}
                      onPointerUp={handlePositionCanvasPointerUp}
                      onPointerCancel={handlePositionCanvasPointerUp}
                    >
                      {managerPreviewUrls[positionRuleDraft.first] && (
                        <img
                          className={`position-preview-layer ${activePositionTraitSide === 'first' ? 'active' : ''}`}
                          src={managerPreviewUrls[positionRuleDraft.first]}
                          alt=""
                          draggable="false"
                          style={{ transform: getPositionCanvasTransform('first', positionFirstTrait) }}
                        />
                      )}
                      {managerPreviewUrls[positionRuleDraft.second] && (
                        <img
                          className={`position-preview-layer ${activePositionTraitSide === 'second' ? 'active' : ''}`}
                          src={managerPreviewUrls[positionRuleDraft.second]}
                          alt=""
                          draggable="false"
                          style={{ transform: getPositionCanvasTransform('second', positionSecondTrait) }}
                        />
                      )}
                      {!managerPreviewUrls[positionRuleDraft.first] && !managerPreviewUrls[positionRuleDraft.second] && (
                        <Loader2 className="spin" size={22} aria-label="Loading position rule preview" />
                      )}
                      <span className="position-drag-hint">Dragging {activePositionTraitSide === 'first' ? 'first' : 'second'} trait</span>
                    </div>
                  </div>
                )}
                <div className="position-rule-actions">
                  <button
                    className="rule-add"
                    type="button"
                    disabled={busy || !positionRuleDraft.first || !positionRuleDraft.second || positionRuleDraft.first === positionRuleDraft.second}
                    onClick={() => addPositionRule(true)}
                  >
                    <ArrowDown size={16} />
                    Save &amp; continue
                  </button>
                  <button
                    className="rule-add"
                    type="button"
                    disabled={busy || !positionRuleDraft.first || !positionRuleDraft.second || positionRuleDraft.first === positionRuleDraft.second}
                    onClick={() => addPositionRule()}
                    title="Save this pair without advancing"
                  >
                    <SlidersHorizontal size={16} />
                    Save only
                  </button>
                </div>
                {positionRules.length ? (
                  <div className="rule-list">
                    {positionRules.map((rule, index) => (
                      <div className="rule-row position-rule-row" key={makeRuleKey(rule)}>
                        <span>{formatPositionRule(rule, traitOptionMap)}</span>
                        <button type="button" disabled={busy} aria-label={`Remove position rule ${formatPositionRule(rule, traitOptionMap)}`} onClick={() => removePositionRule(index)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : <p className="manager-empty">No pair-specific position rules yet.</p>}
              </section>
              )}

              {activeRuleManagerTab === 'folder-rules' && (
              <section className="rule-manager-section">
                <div className="rule-manager-title">
                  <span>
                    <FolderOpen size={16} />
                    Folder rules
                  </span>
                  <strong>{categoryRequirements.length}</strong>
                </div>
                <p>Tick every folder that should only apply when the selected trait appears.</p>
                <fieldset className="multi-rule-picker">
                  <legend>Folders</legend>
                  <div className="multi-rule-options">
                    {source.categories.map((category, index) => {
                      const hasRule = categoryRequirementNames.has(category.name)
                      return (
                        <label className="multi-rule-option" key={`${category.name}-${index}`}>
                          <input
                            type="checkbox"
                            checked={conditionDraft.categories.includes(category.name)}
                            disabled={busy || hasRule}
                            onChange={() => toggleConditionCategory(category.name)}
                          />
                          <span>{category.name}</span>
                          {hasRule && <small>Rule exists</small>}
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
                <div className="trait-picker-field">
                  <label>
                    Only apply when
                    <select value={conditionDraft.requiredTrait} disabled={busy} onChange={(event) => setConditionDraft((current) => ({ ...current, requiredTrait: event.target.value }))}>
                      <option value="">Choose trait</option>
                      {traitOptions.map((trait) => <option value={trait.key} key={trait.key}>{trait.label}</option>)}
                    </select>
                  </label>
                  <ManagerTraitPreview traitKey={conditionDraft.requiredTrait} url={managerPreviewUrls[conditionDraft.requiredTrait]} label={traitOptionMap.get(conditionDraft.requiredTrait)} />
                </div>
                <button className="rule-add" type="button" disabled={busy || !pendingFolderRuleCount || !conditionDraft.requiredTrait} onClick={addCategoryRequirement}>
                  <Ban size={16} />
                  {pendingFolderRuleCount ? `Add ${pendingFolderRuleCount} folder ${pendingFolderRuleCount === 1 ? 'rule' : 'rules'}` : 'Add folder rules'}
                </button>
                {categoryRequirements.length ? (
                  <div className="rule-list">
                    {categoryRequirements.map((rule, index) => (
                      <div className="rule-row visual-rule-row" key={`${rule.category}-${rule.requiredTrait}`}>
                        <div className="folder-rule-visual">
                          <span><strong>{rule.category}</strong> only applies with</span>
                          <ManagerRuleTraitPreview url={managerPreviewUrls[rule.requiredTrait]} label={traitOptionMap.get(rule.requiredTrait)} />
                        </div>
                        <button type="button" disabled={busy} aria-label={`Remove rule ${formatCategoryRequirement(rule, traitOptionMap)}`} onClick={() => removeCategoryRequirement(index)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : <p className="manager-empty">No conditional folder rules yet.</p>}
              </section>
              )}

              {activeRuleManagerTab === 'folder-conflicts' && (
              <section className="rule-manager-section">
                <div className="rule-manager-title">
                  <span>
                    <Layers3 size={16} />
                    Folder conflicts
                  </span>
                  <strong>{categoryConflicts.length}</strong>
                </div>
                <p>Tick folders on both sides to create every new conflict combination between them.</p>
                <div className="folder-conflict-pickers">
                  <fieldset className="multi-rule-picker">
                    <legend>Folders</legend>
                    <div className="multi-rule-options">
                      {source.categories.map((category, index) => (
                        <label className="multi-rule-option" key={`${category.name}-${index}`}>
                          <input
                            type="checkbox"
                            checked={folderConflictDraft.first.includes(category.name)}
                            disabled={busy}
                            onChange={() => toggleFolderConflictCategory('first', category.name)}
                          />
                          <span>{category.name}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="multi-rule-picker">
                    <legend>Cannot appear with</legend>
                    <div className="multi-rule-options">
                      {source.categories.map((category, index) => (
                        <label className="multi-rule-option" key={`${category.name}-${index}`}>
                          <input
                            type="checkbox"
                            checked={folderConflictDraft.second.includes(category.name)}
                            disabled={busy}
                            onChange={() => toggleFolderConflictCategory('second', category.name)}
                          />
                          <span>{category.name}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
                <button className="rule-add" type="button" disabled={busy || !pendingFolderConflictCount} onClick={addCategoryConflict}>
                  <Ban size={16} />
                  {pendingFolderConflictCount ? `Add ${pendingFolderConflictCount} folder ${pendingFolderConflictCount === 1 ? 'conflict' : 'conflicts'}` : 'Add folder conflicts'}
                </button>
                {categoryConflicts.length ? (
                  <div className="rule-list">
                    {categoryConflicts.map((rule, index) => (
                      <div className="rule-row" key={makeRuleKey(rule)}>
                        <span>{formatCategoryConflict(rule)}</span>
                        <button type="button" disabled={busy} aria-label={`Remove rule ${formatCategoryConflict(rule)}`} onClick={() => removeCategoryConflict(index)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : <p className="manager-empty">No folder conflicts yet.</p>}
              </section>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

function readStoredValue(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStoredValue(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Access still works for this tab when browser storage is unavailable.
  }
}

function CommittedDecimalInput({ value, min = 0, max = 100, onCommit, ...inputProps }) {
  const [draft, setDraft] = useState(String(value ?? ''))

  useEffect(() => {
    setDraft(String(value ?? ''))
  }, [value])

  function commit() {
    const parsed = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(value ?? ''))
      return
    }
    const nextValue = clampDecimal(parsed, Number(min), Number(max))
    setDraft(String(nextValue))
    if (nextValue !== Number(value)) onCommit(nextValue)
  }

  return (
    <input
      {...inputProps}
      type="number"
      min={min}
      max={max}
      step="any"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(String(value ?? ''))
          event.currentTarget.blur()
        }
      }}
    />
  )
}

async function buildSampleCollage(previews, projectName, background = '#ffffff') {
  if (!previews.length) throw new Error('No preview images are available for the collage.')
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 1000
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create the collage canvas.')

  const padding = 32
  const gap = 18
  const columns = 4
  const rows = 2
  const gridTop = 170
  const gridBottom = 920
  const cellWidth = (canvas.width - padding * 2 - gap * (columns - 1)) / columns
  const cellHeight = (gridBottom - gridTop - gap * (rows - 1)) / rows

  context.fillStyle = '#f3f6fa'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#59708d'
  context.font = '700 28px Arial, sans-serif'
  context.fillText('TRAIT FORGE', padding, 52)
  context.fillStyle = '#111923'
  context.font = '800 58px Arial, sans-serif'
  context.fillText('COLLECTION SAMPLES', padding, 116)
  context.fillStyle = '#607188'
  context.font = '500 25px Arial, sans-serif'
  context.fillText(`${projectName || 'Upcoming NFT Collection'} · ${previews.length} forged trait combinations`, padding, 151)

  for (let index = 0; index < previews.length; index += 1) {
    const preview = previews[index]
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = padding + column * (cellWidth + gap)
    const y = gridTop + row * (cellHeight + gap)
    context.fillStyle = '#ffffff'
    context.fillRect(x, y, cellWidth, cellHeight)
    context.fillStyle = background
    context.fillRect(x + 2, y + 2, cellWidth - 4, cellHeight - 4)

    const { image, cleanup } = await decodeCollageImage(preview.blob)
    const imageScale = Math.min((cellWidth - 4) / image.width, (cellHeight - 4) / image.height)
    const imageWidth = image.width * imageScale
    const imageHeight = image.height * imageScale
    context.drawImage(
      image,
      x + (cellWidth - imageWidth) / 2,
      y + (cellHeight - imageHeight) / 2,
      imageWidth,
      imageHeight,
    )
    cleanup()

    context.fillStyle = 'rgba(15, 20, 25, 0.82)'
    context.fillRect(x + 12, y + cellHeight - 48, 66, 34)
    context.fillStyle = '#ffffff'
    context.font = '800 20px Arial, sans-serif'
    context.fillText(`#${preview.edition}`, x + 22, y + cellHeight - 24)
    context.strokeStyle = '#d4dce7'
    context.lineWidth = 2
    context.strokeRect(x, y, cellWidth, cellHeight)
  }

  context.fillStyle = '#607188'
  context.font = '700 24px Arial, sans-serif'
  context.fillText('Forged on trait-forge.art', padding, 966)
  context.textAlign = 'right'
  context.fillText('Rarities · Positions · Compatibility rules', canvas.width - padding, 966)
  context.textAlign = 'left'
  return canvasToBlob(canvas, 'image/png')
}

async function decodeCollageImage(blob) {
  if (globalThis.createImageBitmap) {
    const image = await createImageBitmap(blob)
    return { image, cleanup: () => image.close?.() }
  }
  const url = URL.createObjectURL(blob)
  const image = new Image()
  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not decode a preview for the collage.'))
    }
    image.src = url
  })
  return { image, cleanup: () => URL.revokeObjectURL(url) }
}

function downloadBlobUrl(url, fileName) {
  const download = document.createElement('a')
  download.href = url
  download.download = fileName
  document.body.appendChild(download)
  download.click()
  download.remove()
}

async function readResponseError(response, fallback) {
  try {
    const payload = await response.json()
    return payload?.message || payload?.error || fallback
  } catch {
    return fallback
  }
}

function ManagerTraitPreview({ traitKey, url, label }) {
  const shortLabel = label?.split(' / ').at(-1) || 'Select a trait'
  return (
    <div className={`manager-trait-preview ${traitKey ? 'selected' : ''}`} aria-live="polite">
      <div className="manager-trait-preview-frame">
        {url ? (
          <img src={url} alt={`${label} preview`} />
        ) : traitKey ? (
          <Loader2 className="spin" size={19} aria-label="Loading trait preview" />
        ) : (
          <ImagePlus size={19} aria-hidden="true" />
        )}
      </div>
      <span title={label}>{shortLabel}</span>
    </div>
  )
}

function OneOfOneThumbnail({ artwork }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const image = artwork?.image
    if (!canvas || !image?.naturalWidth || !image.naturalHeight) return
    const context = canvas.getContext('2d')
    const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight)
    const width = image.naturalWidth * scale
    const height = image.naturalHeight * scale
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
  }, [artwork])

  return <canvas ref={canvasRef} width="76" height="76" aria-hidden="true" />
}

function PairPositionDraftControls({ traitKey, label, offsetX, offsetY, scale, onChange, onScaleChange }) {
  if (!traitKey) return <div className="trait-position-controls empty">Select a trait to set its pair position.</div>
  const traitName = label?.split(' / ').at(-1) || 'trait'
  return (
    <div className="trait-position-controls">
      <span>
        <small>X</small>
        <input
          type="text"
          inputMode="numeric"
          pattern="-?[0-9]*"
          value={offsetX}
          aria-label={`Pair-specific horizontal position for ${traitName}`}
          onChange={(event) => onChange('x', event.target.value)}
          onBlur={(event) => {
            if (event.target.value === '' || event.target.value === '-') onChange('x', '0')
          }}
        />
      </span>
      <span>
        <small>Y</small>
        <input
          type="text"
          inputMode="numeric"
          pattern="-?[0-9]*"
          value={offsetY}
          aria-label={`Pair-specific vertical position for ${traitName}`}
          onChange={(event) => onChange('y', event.target.value)}
          onBlur={(event) => {
            if (event.target.value === '' || event.target.value === '-') onChange('y', '0')
          }}
        />
      </span>
      <div className="scale-control">
        <small>Size</small>
        <div className="input-with-suffix compact-suffix">
          <input
            type="number"
            min="10"
            max="300"
            step="1"
            value={scale}
            aria-label={`Pair-specific scale for ${traitName}`}
            onChange={(event) => onScaleChange(event.target.value)}
            onBlur={(event) => {
              onScaleChange(String(normalizeRuleScale(event.target.value || 100)))
            }}
          />
          <b>%</b>
        </div>
      </div>
    </div>
  )
}

function ManagerRuleTraitPreview({ url, label }) {
  return (
    <div className="manager-rule-trait" title={label}>
      <div className="manager-rule-trait-frame">
        {url ? <img src={url} alt={`${label} preview`} /> : <Loader2 className="spin" size={15} aria-label="Loading trait preview" />}
      </div>
      <span>{label?.split(' / ').at(-1) || 'Trait'}</span>
    </div>
  )
}

function buildProjectBackup(source, project, savedAt = new Date().toISOString()) {
  const traitRecords = source.categories.flatMap((category, categoryIndex) =>
    category.traits.map((trait, traitIndex) => ({
      categoryIndex,
      traitIndex,
      id: getTraitId(trait),
      category: category.name,
      originalName: trait.originalName,
      name: trait.name,
      weight: getTraitWeight(trait),
      offsetX: getTraitOffset(trait, 'x'),
      offsetY: getTraitOffset(trait, 'y'),
    })),
  )
  const matchesForId = (id) =>
    traitRecords
      .filter((trait) => trait.id === id)
      .map(({ categoryIndex, traitIndex, category, originalName, name }) => ({
        categoryIndex,
        traitIndex,
        category,
        originalName,
        name,
      }))

  return {
    version: 1,
    savedAt,
    project,
    source: {
      type: source.type,
      name: source.name,
      width: source.width,
      height: source.height,
      categories: source.categories.map((category, categoryIndex) => ({
        categoryIndex,
        name: category.name,
        enabled: category.enabled !== false,
        selectionMode: getCategorySelectionMode(category),
        noneWeight: getCategoryNoneWeight(category),
        traits: category.traits.map((trait, traitIndex) => ({
          traitIndex,
          id: getTraitId(trait),
          originalName: trait.originalName,
          name: trait.name,
          weight: getTraitWeight(trait),
          offsetX: getTraitOffset(trait, 'x'),
          offsetY: getTraitOffset(trait, 'y'),
        })),
      })),
      incompatibilities: (source.incompatibilities || []).map((rule) => ({
        first: rule.first,
        second: rule.second,
        firstMatches: matchesForId(rule.first),
        secondMatches: matchesForId(rule.second),
      })),
      positionRules: (source.positionRules || []).map((rule) => ({ ...rule })),
      categoryRequirements: source.categoryRequirements || [],
      categoryConflicts: source.categoryConflicts || [],
      oneOfOnes: (source.oneOfOnes || []).map((artwork) => ({
        id: artwork.id,
        originalName: artwork.originalName,
        name: getOneOfOneName(artwork),
        fileName: artwork.fileName,
      })),
    },
  }
}

function restoreProjectBackup(source, backup) {
  if (backup?.version !== 1 || !backup.source?.categories?.length) {
    throw new Error('This is not a supported Trait Forge project backup.')
  }
  if (backup.source.type !== source.type) {
    throw new Error(`This backup expects a ${backup.source.type} source, but the loaded source is ${source.type}.`)
  }

  const unusedCategories = new Set(source.categories)
  const restoredCategoryByCurrentCategory = new Map()
  const restoredIdByBackupId = new Map()

  for (const backupCategory of backup.source.categories) {
    const backupIds = new Set(backupCategory.traits.map((trait) => trait.id))
    let currentCategory = [...unusedCategories]
      .map((category) => ({
        category,
        matches: category.traits.filter((trait) => backupIds.has(getTraitId(trait))).length,
      }))
      .sort((first, second) => second.matches - first.matches)[0]

    if (!currentCategory?.matches) {
      currentCategory = { category: source.categories[backupCategory.categoryIndex], matches: 0 }
    }
    if (!currentCategory.category || !unusedCategories.has(currentCategory.category)) {
      throw new Error(`Could not match the backed-up group "${backupCategory.name}" to the loaded source.`)
    }
    if (currentCategory.category.traits.length < backupCategory.traits.length) {
      throw new Error(
        `Group "${backupCategory.name}" has ${currentCategory.category.traits.length} loaded traits but the backup expects ${backupCategory.traits.length}.`,
      )
    }

    unusedCategories.delete(currentCategory.category)
    const { matches, extras } = matchBackupTraits(currentCategory.category.traits, backupCategory.traits)
    const restoredTraitByCurrentTrait = new Map()
    backupCategory.traits.forEach((backupTrait, traitIndex) => {
      const currentTrait = matches[traitIndex]
      restoredIdByBackupId.set(backupTrait.id, getTraitId(currentTrait))
      const restoredTrait = {
        ...currentTrait,
        category: backupCategory.name,
        name: backupTrait.name,
        weight: clampDecimal(backupTrait.weight, 0, 100),
        offsetX: Number.isFinite(Number(backupTrait.offsetX)) ? Math.round(Number(backupTrait.offsetX)) : 0,
        offsetY: Number.isFinite(Number(backupTrait.offsetY)) ? Math.round(Number(backupTrait.offsetY)) : 0,
      }
      restoredTraitByCurrentTrait.set(currentTrait, restoredTrait)
    })
    const extraTraits = new Set(extras)
    const mergedTraits = currentCategory.category.traits.map((trait) =>
      extraTraits.has(trait) ? { ...trait, category: backupCategory.name } : restoredTraitByCurrentTrait.get(trait),
    )

    restoredCategoryByCurrentCategory.set(currentCategory.category, {
      ...currentCategory.category,
      name: backupCategory.name,
      enabled: backupCategory.enabled !== false,
      selectionMode: getCategorySelectionMode(backupCategory),
      noneWeight: clampDecimal(backupCategory.noneWeight, 0, 100),
      traits: mergedTraits,
    })
  }

  const restoredCategories = source.categories.map((category) =>
    restoredCategoryByCurrentCategory.get(category) || category,
  )

  const remapTraitId = (id) => restoredIdByBackupId.get(id) || id
  const incompatibilities = (backup.source.incompatibilities || []).map((rule) => ({
    first: remapTraitId(rule.first),
    second: remapTraitId(rule.second),
  }))
  const positionRules = (backup.source.positionRules || []).map((rule) => ({
    first: remapTraitId(rule.first),
    second: remapTraitId(rule.second),
    firstOffsetX: Math.round(Number(rule.firstOffsetX) || 0),
    firstOffsetY: Math.round(Number(rule.firstOffsetY) || 0),
    firstScale: normalizeRuleScale(rule.firstScale),
    secondOffsetX: Math.round(Number(rule.secondOffsetX) || 0),
    secondOffsetY: Math.round(Number(rule.secondOffsetY) || 0),
    secondScale: normalizeRuleScale(rule.secondScale),
  }))
  const restoredSource = {
    ...source,
    categories: restoredCategories,
    oneOfOnes: (source.oneOfOnes || []).map((artwork) => {
      const backupArtwork = (backup.source.oneOfOnes || []).find((candidate) => (
        candidate.id === artwork.id || candidate.originalName === artwork.originalName || candidate.fileName === artwork.fileName
      ))
      return backupArtwork ? { ...artwork, name: backupArtwork.name } : artwork
    }),
    incompatibilities,
    positionRules,
    categoryRequirements: (backup.source.categoryRequirements || []).map((rule) => ({
      ...rule,
      requiredTrait: remapTraitId(rule.requiredTrait),
    })),
    categoryConflicts: backup.source.categoryConflicts || [],
  }
  const invalidRule = findInvalidRuleReference(restoredSource)
  if (invalidRule) throw new Error(invalidRule)

  const restoredProject = { ...DEFAULT_PROJECT, ...backup.project }
  delete restoredProject.startAt

  return {
    project: restoredProject,
    source: restoredSource,
    traitCount: backup.source.categories.reduce((total, category) => total + category.traits.length, 0),
    skippedTraitCount: restoredCategories.reduce((total, category) => total + category.traits.length, 0) -
      backup.source.categories.reduce((total, category) => total + category.traits.length, 0),
    ruleCount: incompatibilities.length + positionRules.length,
  }
}

function matchBackupTraits(currentTraits, backupTraits) {
  const backupCount = backupTraits.length
  const currentCount = currentTraits.length
  const impossible = Number.NEGATIVE_INFINITY
  const scores = Array.from({ length: backupCount + 1 }, () => Array(currentCount + 1).fill(impossible))
  const choices = Array.from({ length: backupCount }, () => Array(currentCount).fill(''))

  for (let currentIndex = 0; currentIndex <= currentCount; currentIndex += 1) {
    scores[backupCount][currentIndex] = 0
  }

  for (let backupIndex = backupCount - 1; backupIndex >= 0; backupIndex -= 1) {
    for (let currentIndex = currentCount - 1; currentIndex >= 0; currentIndex -= 1) {
      if (currentCount - currentIndex < backupCount - backupIndex) continue
      const matchScore =
        scoreTraitMatch(currentTraits[currentIndex], backupTraits[backupIndex]) +
        scores[backupIndex + 1][currentIndex + 1]
      const skipScore = scores[backupIndex][currentIndex + 1]
      if (matchScore >= skipScore) {
        scores[backupIndex][currentIndex] = matchScore
        choices[backupIndex][currentIndex] = 'match'
      } else {
        scores[backupIndex][currentIndex] = skipScore
        choices[backupIndex][currentIndex] = 'skip'
      }
    }
  }

  const matches = []
  const extras = []
  let backupIndex = 0
  let currentIndex = 0
  while (currentIndex < currentCount) {
    if (backupIndex < backupCount && choices[backupIndex][currentIndex] === 'match') {
      matches.push(currentTraits[currentIndex])
      backupIndex += 1
    } else {
      extras.push(currentTraits[currentIndex])
    }
    currentIndex += 1
  }

  if (matches.length !== backupCount) {
    throw new Error('Could not match every backed-up trait to the loaded source.')
  }
  return { matches, extras }
}

function scoreTraitMatch(currentTrait, backupTrait) {
  if (getTraitId(currentTrait) === backupTrait.id) return 1000
  if (currentTrait.originalName === backupTrait.originalName) return 10
  if (cleanName(currentTrait.originalName || currentTrait.name) === cleanName(backupTrait.originalName || backupTrait.name)) return 5
  return -100
}

function findInvalidRuleReference(source) {
  const traitIds = new Set(source.categories.flatMap((category) => category.traits.map((trait) => getTraitId(trait))))
  for (const rule of source.incompatibilities || []) {
    if (!traitIds.has(rule.first) || !traitIds.has(rule.second)) {
      return 'The backup contains an incompatibility rule that does not match the loaded source.'
    }
  }
  for (const rule of source.positionRules || []) {
    if (!traitIds.has(rule.first) || !traitIds.has(rule.second)) {
      return 'The backup contains a position rule that does not match the loaded source.'
    }
  }
  for (const rule of source.categoryRequirements || []) {
    if (!source.categories.some((category) => category.name === rule.category) || !traitIds.has(rule.requiredTrait)) {
      return 'The backup contains a folder rule that does not match the loaded source.'
    }
  }
  return ''
}

function parsePsd(psd, fileName) {
  const rootChildren = psd.children || []
  const baseLayers = rootChildren.filter((child) => !child.children?.length && hasRenderableCanvas(child))
  const categories = sortCategoriesForRender(
    rootChildren
      .filter((child) => child.children?.length)
      .map((group) => ({
        name: cleanName(group.name),
        traits: group.children
          .filter((child) => child.visible !== false)
          .map((child, index) => makePsdTrait(child, cleanName(group.name), index))
          .filter(Boolean),
      }))
      .filter((category) => category.traits.length),
  )

  if (!categories.length) {
    throw new Error('No trait folders found. Put traits inside root-level PSD groups.')
  }

  return {
    type: 'psd',
    name: fileName,
    width: psd.width,
    height: psd.height,
    baseLayers,
    categories,
    oneOfOnes: [],
    incompatibilities: [],
    positionRules: [],
    categoryRequirements: [],
    categoryConflicts: [],
  }
}

function estimatePsdBitmapBytes(psd) {
  let total = 0
  const visit = (layers = []) => {
    for (const layer of layers) {
      if (layer.children?.length) {
        visit(layer.children)
        continue
      }
      if (!layer.rawData) continue
      const width = Math.max(0, Number(layer.right) - Number(layer.left))
      const height = Math.max(0, Number(layer.bottom) - Number(layer.top))
      total += width * height * 4
    }
  }
  visit(psd.children)
  return total
}

function decodePsdLayerPixels(layers = []) {
  for (const layer of layers) {
    if (layer.children?.length) decodePsdLayerPixels(layer.children)
    else if (layer.rawData) decodeLayerPixels(layer)
  }
}

function makePsdTrait(node, category, index) {
  const layers = collectRenderableLayers(node)
  if (!layers.length) return null
  const name = cleanName(node.name)
  return {
    type: 'psd',
    id: makeTraitId(category, `${index}:${name}`),
    category,
    originalName: name,
    name,
    weight: 1,
    layers,
  }
}

function collectRenderableLayers(node) {
  if (node.visible === false) return []
  if (!node.children?.length) return hasRenderableCanvas(node) ? [node] : []
  return [...node.children].reverse().flatMap((child) => collectRenderableLayers(child))
}

async function parseFolders(files, baseFile) {
  const imageFiles = files
    .filter(isArtworkFile)
    .sort((first, second) => (first.webkitRelativePath || first.name).localeCompare(second.webkitRelativePath || second.name))
  if (!imageFiles.length) {
    throw new Error('No PNG, JPG, WebP, or Procreate trait artwork found in the selected folder.')
  }

  const stripped = stripCommonRoot(imageFiles)
  const categoryMap = new Map()
  for (const item of stripped) {
    const parts = item.path.split('/').filter(Boolean)
    if (parts.length < 2) continue
    const category = cleanName(parts[0])
    const traitName = cleanName(parts.slice(1).join(' ').replace(/\.[^.]+$/, ''))
    const image = await loadImageFromFile(item.file)
    const traits = categoryMap.get(category) || []
    traits.push({
      type: 'image',
      id: makeTraitId(category, item.path),
      category,
      originalName: traitName,
      name: traitName,
      weight: 1,
      image,
      fileName: item.file.name,
    })
    categoryMap.set(category, traits)
  }

  const categories = sortCategoriesForRender(
    Array.from(categoryMap, ([name, traits]) => ({
      name,
      traits: traits.sort((first, second) => first.name.localeCompare(second.name)),
    })).sort((first, second) => first.name.localeCompare(second.name)),
  )
  if (!categories.length) {
    throw new Error('Put image files one level inside category folders, for example Hats/Blue.png.')
  }

  const baseImage = baseFile ? await loadImageFromFile(baseFile) : null
  const width = baseImage?.naturalWidth || Math.max(...categories.flatMap((category) => category.traits.map((trait) => trait.image.naturalWidth)))
  const height = baseImage?.naturalHeight || Math.max(...categories.flatMap((category) => category.traits.map((trait) => trait.image.naturalHeight)))

  return {
    type: 'folder',
    name: 'Folder upload',
    width,
    height,
    baseImage,
    categories,
    oneOfOnes: [],
    incompatibilities: [],
    positionRules: [],
    categoryRequirements: [],
    categoryConflicts: [],
  }
}

function stripCommonRoot(files) {
  const mapped = files.map((file) => ({ file, path: file.webkitRelativePath || file.name }))
  const firstParts = mapped.map((item) => item.path.split('/').filter(Boolean))
  const shouldStrip = firstParts.every((parts) => parts.length > 2 && parts[0] === firstParts[0][0])
  if (!shouldStrip) return mapped
  return mapped.map((item) => ({ ...item, path: item.path.split('/').slice(1).join('/') }))
}

async function renderArtwork(source, traits, options = {}) {
  const renderLimit = Number(options.renderMaxDimension) || 0
  const includeBase = options.includeBase !== false
  const longestSourceSide = Math.max(source.width, source.height)
  const renderScale = renderLimit && longestSourceSide > renderLimit ? renderLimit / longestSourceSide : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.width * renderScale))
  canvas.height = Math.max(1, Math.round(source.height * renderScale))
  const context = canvas.getContext('2d')
  context.clearRect(0, 0, canvas.width, canvas.height)
  if (renderScale !== 1) {
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.scale(renderScale, renderScale)
  }
  const positionOverrides = getPairPositionOverrides(traits, source.positionRules)

  if (source.type === 'psd') {
    if (includeBase) {
      for (const layer of [...source.baseLayers].reverse()) {
        drawPsdLayer(context, layer)
      }
    }
    for (const trait of traits) {
      if (trait.isNone) continue
      const position = positionOverrides.get(getTraitId(trait)) || { x: getTraitOffset(trait, 'x'), y: getTraitOffset(trait, 'y'), scale: 1 }
      drawTraitArtwork(context, trait, position, source)
    }
  } else {
    if (includeBase && source.baseImage) context.drawImage(source.baseImage, 0, 0, source.width, source.height)
    for (const trait of traits) {
      if (trait.isNone) continue
      const position = positionOverrides.get(getTraitId(trait)) || { x: getTraitOffset(trait, 'x'), y: getTraitOffset(trait, 'y'), scale: 1 }
      drawTraitArtwork(context, trait, position, source)
    }
  }

  const exportCanvas = prepareCanvasForExport(canvas, options)
  try {
    return await canvasToBlob(exportCanvas, options.mime || 'image/png', options.quality)
  } finally {
    // Resetting a canvas immediately releases its backing store in Safari. This
    // keeps thousands of sequential renders from accumulating GPU memory.
    if (exportCanvas !== canvas) {
      exportCanvas.width = 0
      exportCanvas.height = 0
    }
    canvas.width = 0
    canvas.height = 0
  }
}

function getPairPositionOverrides(traits, positionRules = []) {
  const selectedTraitIds = new Set(traits.filter((trait) => !trait.isNone).map((trait) => getTraitId(trait)))
  const overrides = new Map()
  for (const rule of positionRules || []) {
    if (!selectedTraitIds.has(rule.first) || !selectedTraitIds.has(rule.second)) continue
    overrides.set(rule.first, {
      x: Math.round(Number(rule.firstOffsetX) || 0),
      y: Math.round(Number(rule.firstOffsetY) || 0),
      scale: normalizeRuleScale(rule.firstScale) / 100,
    })
    overrides.set(rule.second, {
      x: Math.round(Number(rule.secondOffsetX) || 0),
      y: Math.round(Number(rule.secondOffsetY) || 0),
      scale: normalizeRuleScale(rule.secondScale) / 100,
    })
  }
  return overrides
}

function drawTraitArtwork(context, trait, position, source) {
  const scale = Number.isFinite(position.scale) ? position.scale : 1
  context.save()
  context.translate(position.x + source.width / 2, position.y + source.height / 2)
  context.scale(scale, scale)
  context.translate(-source.width / 2, -source.height / 2)
  if (trait.type === 'image') {
    context.drawImage(trait.image, 0, 0, source.width, source.height)
  } else {
    for (const layer of trait.layers) drawPsdLayer(context, layer)
  }
  context.restore()
}

function drawPsdLayer(context, layer, offsetX = 0, offsetY = 0) {
  if (!hasRenderableCanvas(layer)) return
  const canvas = layer.canvas || (layer.rawData ? getLayerCanvas(layer) : null)
  if (!canvas) return
  const opacity = typeof layer.opacity === 'number' ? layer.opacity : 1
  context.save()
  context.globalAlpha = opacity
  context.drawImage(canvas, (layer.left || 0) + offsetX, (layer.top || 0) + offsetY)
  context.restore()
  if (!layer.canvas) {
    canvas.width = 0
    canvas.height = 0
  }
}

function sortCategoriesForRender(categories) {
  return [...categories]
    .map((category) => ({ enabled: true, ...category }))
    .sort((first, second) => categoryPriority(first.name) - categoryPriority(second.name))
}

function categoryPriority(name) {
  const normalized = name.toLowerCase()
  if (/^(bg|background|backdrop|base|scene|sky|floor)\b/.test(normalized)) return 0
  if (/^(body|skin|character|person|head|face)\b/.test(normalized)) return 10
  if (/^(clothes|clothing|shirt|jacket|pants|outfit)\b/.test(normalized)) return 20
  if (/^(eyes|mouth|hair|hat|accessory|accessories)\b/.test(normalized)) return 30
  return 15
}

function buildUniqueRandomCombinations(categories, count, seed, rules = {}) {
  const combos = []
  const seen = new Set()
  let attempt = 0
  const maxAttempts = Math.max(count * 50, 1000)
  while (combos.length < count && attempt < maxAttempts) {
    const combo = buildRandomCombination(categories, seed, attempt, rules, combos.length)
    if ((!combo.length && categories.length) || findCombinationViolation(combo, rules)) {
      attempt += 1
      continue
    }
    const key = makeCombinationKey(combo)
    if (!seen.has(key)) {
      seen.add(key)
      combos.push(combo)
    }
    attempt += 1
  }
  if (combos.length < count && !hasOrderedCategories(categories)) {
    for (const combo of buildCombinationsUpTo(categories, rules, count)) {
      const key = makeCombinationKey(combo)
      if (!seen.has(key)) {
        seen.add(key)
        combos.push(combo)
      }
      if (combos.length >= count) break
    }
  }
  return combos
}

function buildRandomCombination(categories, seed, index, rules = {}, balancedIndex = index) {
  const random = mulberry32(hashString(`${seed}:${index}`))
  const combo = []
  for (const category of categories) {
    if (!shouldApplyCategory(category, combo, rules.categoryRequirements, rules.categoryConflicts)) continue
    const availableTraits = getCategoryChoices(category).filter((trait) => isTraitCompatibleWithCombo(trait, combo, rules.incompatibilities))
    if (!availableTraits.length) return []
    const orderedTraits = getCategorySelectionMode(category) === 'ordered'
      ? availableTraits.filter((trait) => !trait.isNone)
      : []
    const selectedTrait = orderedTraits.length
      ? orderedTraits[balancedIndex % orderedTraits.length]
      : pickWeightedTrait(availableTraits, random)
    combo.push(selectedTrait)
  }
  return combo
}

function buildCombinationsUpTo(categories, rules = {}, limit = Number.POSITIVE_INFINITY) {
  const combos = []

  function addCategory(categoryIndex, combo) {
    if (combos.length >= limit) return
    if (categoryIndex >= categories.length) {
      if (!findCombinationViolation(combo, rules)) combos.push(combo)
      return
    }

    const category = categories[categoryIndex]
    if (!shouldApplyCategory(category, combo, rules.categoryRequirements, rules.categoryConflicts)) {
      addCategory(categoryIndex + 1, combo)
      return
    }

    for (const trait of getCategoryChoices(category)) {
      if (isTraitCompatibleWithCombo(trait, combo, rules.incompatibilities)) {
        addCategory(categoryIndex + 1, [...combo, trait])
      }
    }
  }

  addCategory(0, [])
  return combos
}

function countValidCombinations(categories, rules = {}, limit = Number.POSITIVE_INFINITY, timeBudgetMs = COMBO_COUNT_TIME_BUDGET_MS) {
  if (!rules.incompatibilities?.length && !rules.categoryRequirements?.length && !rules.categoryConflicts?.length) {
    let orderedCycleLength = 1
    let mixedCombinationCount = 1
    for (const category of categories) {
      const choiceCount = getCategoryChoices(category).filter((trait) => (
        getCategorySelectionMode(category) !== 'ordered' || !trait.isNone
      )).length
      if (getCategorySelectionMode(category) === 'ordered') {
        orderedCycleLength = leastCommonMultiple(orderedCycleLength, choiceCount)
      } else {
        mixedCombinationCount *= choiceCount
      }
      if (orderedCycleLength * mixedCombinationCount > limit) return { count: limit, capped: true }
    }
    const count = orderedCycleLength * mixedCombinationCount
    return { count, capped: false }
  }

  const startedAt = globalThis.performance?.now?.() ?? Date.now()
  const incompatibilityKeys = new Set((rules.incompatibilities || []).map((rule) => makeRuleKey(rule)))
  const categoryRequirements = new Map((rules.categoryRequirements || []).map((rule) => [rule.category, rule.requiredTrait]))
  const categoryConflictKeys = new Set((rules.categoryConflicts || []).map((rule) => makeRuleKey(rule)))
  let operations = 0
  let timedOut = false

  function exceededTimeBudget() {
    operations += 1
    if (timedOut) return true
    if ((operations & 255) !== 0) return false
    const now = globalThis.performance?.now?.() ?? Date.now()
    timedOut = now - startedAt >= timeBudgetMs
    return timedOut
  }

  function isCompatible(trait, combo) {
    if (trait.isNone) return true
    const traitId = makeTraitKey(trait)
    return combo.every((selectedTrait) => selectedTrait.isNone || !incompatibilityKeys.has(makeRuleKey({ first: traitId, second: makeTraitKey(selectedTrait) })))
  }

  function shouldApply(category, combo) {
    const requirement = categoryRequirements.get(category.name)
    if (requirement && !combo.some((trait) => makeTraitKey(trait) === requirement)) return false
    return !combo.some((trait) => !trait.isNone && categoryConflictKeys.has(makeRuleKey({ first: category.name, second: trait.category })))
  }

  function countFrom(categoryIndex, combo) {
    if (exceededTimeBudget()) return 0
    if (categoryIndex >= categories.length) return 1
    const category = categories[categoryIndex]
    if (!shouldApply(category, combo)) {
      return countFrom(categoryIndex + 1, combo)
    }

    let count = 0
    for (const trait of getCategoryChoices(category)) {
      if (isCompatible(trait, combo)) {
        count += countFrom(categoryIndex + 1, [...combo, trait])
        if (timedOut) break
        if (count > limit) return count
      }
    }
    return count
  }

  const count = countFrom(0, [])
  if (timedOut) return { count: Math.min(count, limit), capped: true, approximate: true }
  return { count: Math.min(count, limit), capped: count > limit, approximate: false }
}

function isTraitCompatibleWithCombo(trait, combo, incompatibilities = []) {
  if (trait.isNone) return true
  return combo.every((selectedTrait) => !areTraitsIncompatible(trait, selectedTrait, incompatibilities))
}

function shouldApplyCategory(category, combo, categoryRequirements = [], categoryConflicts = []) {
  const requirement = categoryRequirements.find((rule) => rule.category === category.name)
  if (requirement && !combo.some((trait) => makeTraitKey(trait) === requirement.requiredTrait)) return false
  return !combo.some((trait) => !trait.isNone && areCategoriesIncompatible(category.name, trait.category, categoryConflicts))
}

function areTraitsIncompatible(firstTrait, secondTrait, incompatibilities = []) {
  const first = makeTraitKey(firstTrait)
  const second = makeTraitKey(secondTrait)
  return incompatibilities.some((rule) => {
    const [ruleFirst, ruleSecond] = normalizeRule(rule.first, rule.second)
    return first === ruleFirst && second === ruleSecond
  })
}

function getActiveCategories(categories) {
  return categories
    .filter((category) => category.enabled !== false)
    .map((category) => ({ ...category, traits: getWeightedTraits(category) }))
    .filter((category) => category.traits.length)
}

function getWeightedTraits(category) {
  return getCategoryChoices(category).filter((trait) => getTraitWeight(trait) > 0)
}

function getCategoryChoices(category) {
  const choices = [...category.traits]
  if (choices.some((trait) => trait.isNone)) return choices
  const noneWeight = getCategoryNoneWeight(category)
  if (noneWeight > 0) {
    choices.push({
      type: 'none',
      isNone: true,
      id: makeTraitId(category.name, '__none__'),
      category: category.name,
      originalName: 'None',
      name: 'None',
      weight: noneWeight,
    })
  }
  return choices
}

function getTraitWeight(trait) {
  const weight = Number(trait.weight ?? 1)
  return Number.isFinite(weight) ? Math.max(0, weight) : 0
}

function getCategoryTotalWeight(category) {
  if (!category) return 0
  return category.traits.reduce((total, trait) => total + getTraitWeight(trait), getCategoryNoneWeight(category))
}

function getNormalizedTraitChance(category, trait) {
  if (!category || !trait) return 0
  const totalWeight = getCategoryTotalWeight(category)
  return totalWeight > 0 ? (getTraitWeight(trait) / totalWeight) * 100 : 0
}

function getNormalizedNoneChance(category) {
  const totalWeight = getCategoryTotalWeight(category)
  return totalWeight > 0 ? (getCategoryNoneWeight(category) / totalWeight) * 100 : 0
}

function formatChance(value) {
  const chance = Number(value)
  if (!Number.isFinite(chance) || chance <= 0) return '0%'
  const precision = chance < 1 ? 2 : 1
  return `${Number(chance.toFixed(precision))}%`
}

function getTraitOffset(trait, axis) {
  const value = Number(axis === 'y' ? trait?.offsetY : trait?.offsetX)
  return Number.isFinite(value) ? Math.round(value) : 0
}

function normalizeRuleScale(value) {
  const scale = Number(value ?? 100)
  return Number.isFinite(scale) ? Math.round(Math.max(10, Math.min(300, scale))) : 100
}

function findDuplicateCategoryNames(categories) {
  const counts = new Map()
  for (const category of categories) {
    const key = category.name.trim().toLocaleLowerCase()
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([key]) => categories.find((category) => category.name.trim().toLocaleLowerCase() === key)?.name || key)
}

function pickWeightedTrait(traits, random) {
  const total = traits.reduce((sum, trait) => sum + getTraitWeight(trait), 0)
  if (total <= 0) return traits[0]
  let target = random() * total
  for (const trait of traits) {
    target -= getTraitWeight(trait)
    if (target <= 0) return trait
  }
  return traits[traits.length - 1]
}

function makeCombinationKey(combo) {
  return combo.map((trait) => getTraitId(trait)).join('|')
}

function makeTraitKey(trait) {
  return getTraitId(trait)
}

function findTraitByKey(source, key) {
  if (!key) return null
  return source.categories.flatMap((category) => category.traits).find((trait) => makeTraitKey(trait) === key) || null
}

function makeTraitId(category, name) {
  return `${category}::${name}`
}

function getTraitId(trait) {
  return trait.id || makeTraitId(trait.category, trait.originalName || trait.name)
}

function getTraitMetadataName(trait) {
  return cleanName(trait.name) || trait.originalName || 'Untitled'
}

function normalizeRule(first, second) {
  return [first, second].sort((left, right) => left.localeCompare(right))
}

function makeRuleKey(rule) {
  const [first, second] = normalizeRule(rule.first, rule.second)
  return `${first}||${second}`
}

function formatRule(rule, traitOptionMap = new Map()) {
  return `${formatTraitKey(rule.first, traitOptionMap)} cannot appear with ${formatTraitKey(rule.second, traitOptionMap)}`
}

function formatCategoryRequirement(rule, traitOptionMap = new Map()) {
  return `${rule.category} only applies with ${formatTraitKey(rule.requiredTrait, traitOptionMap)}`
}

function formatCategoryConflict(rule) {
  return `${rule.first} cannot appear with ${rule.second}`
}

function formatPositionRule(rule, traitOptionMap = new Map()) {
  return `${formatTraitKey(rule.first, traitOptionMap)} (X ${rule.firstOffsetX}, Y ${rule.firstOffsetY}, ${normalizeRuleScale(rule.firstScale)}%) with ${formatTraitKey(rule.second, traitOptionMap)} (X ${rule.secondOffsetX}, Y ${rule.secondOffsetY}, ${normalizeRuleScale(rule.secondScale)}%)`
}

function formatTraitKey(key, traitOptionMap = new Map()) {
  return traitOptionMap.get(key) || key.replace('::', ' / ')
}

function formatComboCount(info) {
  if (info?.approximate) return info.count ? `${info.count.toLocaleString()}+ checked` : 'Large rule set'
  if (!info?.count) return 'No source'
  return `${info.count.toLocaleString()}${info.capped ? '+' : ''} combos`
}

function buildMetadataCsv(categories, rows) {
  const header = ['tokenID', 'name', 'description', 'file_name', 'external_url', ...categories.map((category) => `attributes[${category}]`)]
  return `${[header, ...rows].map((row) => row.map(formatCsvCell).join(',')).join('\r\n')}\r\n`
}

function buildMetadataCsvRow(tokenId, imageFileName, project, categories, combo) {
  const traitByCategory = new Map(combo.filter((trait) => !trait.isNone).map((trait) => [trait.category, getTraitMetadataName(trait)]))
  return [tokenId, `${project.name} #${tokenId}`, project.description, imageFileName, '', ...categories.map((category) => traitByCategory.get(category) || '')]
}

function buildOneOfOneMetadataCsvRow(tokenId, imageFileName, project, categories, artworkName) {
  const values = new Map([
    [ONE_OF_ONE_TRAIT_TYPE, artworkName],
    [RARITY_TRAIT_TYPE, ONE_OF_ONE_TRAIT_TYPE],
  ])
  return [tokenId, `${project.name} #${tokenId} — ${artworkName}`, project.description, imageFileName, '', ...categories.map((category) => values.get(category) || '')]
}

function formatCsvCell(value) {
  const cell = String(value ?? '')
  if (!/[",\n\r]/.test(cell)) return cell
  return `"${cell.replace(/"/g, '""')}"`
}

function getSourceRules(source) {
  return {
    incompatibilities: source?.incompatibilities || [],
    categoryRequirements: source?.categoryRequirements || [],
    categoryConflicts: source?.categoryConflicts || [],
  }
}

function getCombinationStructureKey(source) {
  if (!source?.categories?.length) return ''
  return JSON.stringify({
    categories: source.categories.map((category) => ({
      name: category.name,
      enabled: category.enabled !== false,
      selectionMode: getCategorySelectionMode(category),
      hasNone: getCategoryNoneWeight(category) > 0,
      traits: category.traits.map((trait) => [getTraitId(trait), getTraitWeight(trait) > 0]),
    })),
    rules: getSourceRules(source),
  })
}

function areCategoriesIncompatible(firstCategory, secondCategory, categoryConflicts = []) {
  const [currentFirst, currentSecond] = normalizeRule(firstCategory, secondCategory)
  return categoryConflicts.some((rule) => {
    const [first, second] = normalizeRule(rule.first, rule.second)
    return currentFirst === first && currentSecond === second
  })
}

function getCategoryNoneWeight(category) {
  const weight = Number(category.noneWeight ?? 0)
  return Number.isFinite(weight) ? Math.max(0, weight) : 0
}

function getCategorySelectionMode(category) {
  if (category?.selectionMode === 'ordered') return 'ordered'
  if (category?.selectionMode === 'weighted') return 'weighted'
  return isFaceCategory(category?.name) ? 'ordered' : 'weighted'
}

function hasOrderedCategories(categories = []) {
  return categories.some((category) => getCategorySelectionMode(category) === 'ordered')
}

function leastCommonMultiple(first, second) {
  if (!first || !second) return 0
  let left = Math.abs(first)
  let right = Math.abs(second)
  while (right) [left, right] = [right, left % right]
  return Math.abs(first * second) / left
}

function hashString(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5)
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

async function loadImageFromFile(file) {
  const imageBlob = isProcreateFile(file) ? await extractProcreatePreview(file) : file
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(imageBlob)
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Could not load image ${file.name}.`))
    }
    image.src = url
  })
}

function isImageFile(file) {
  return IMAGE_TYPES.includes(file?.type) || /\.(png|jpe?g|webp)$/i.test(file?.name || '')
}

function isArtworkFile(file) {
  return isImageFile(file) || isProcreateFile(file)
}

function isPsdFile(file) {
  return file?.type === 'image/vnd.adobe.photoshop' || /\.psd$/i.test(file?.name || '')
}

async function collectDroppedFiles(dataTransfer) {
  const entries = Array.from(dataTransfer?.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean)
  if (!entries.length) return Array.from(dataTransfer?.files || [])
  const nestedFiles = await Promise.all(entries.map(readDroppedEntry))
  return nestedFiles.flat()
}

async function readDroppedEntry(entry) {
  if (entry.isFile) {
    return new Promise((resolve, reject) => entry.file((file) => resolve([file]), reject))
  }
  if (!entry.isDirectory) return []
  const reader = entry.createReader()
  const children = []
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
    if (!batch.length) break
    children.push(...batch)
  }
  return (await Promise.all(children.map(readDroppedEntry))).flat()
}

function makeOneOfOneId(name) {
  return `one-of-one::${name}`
}

function getOneOfOneName(artwork) {
  return cleanName(artwork?.name) || artwork?.originalName || 'Untitled 1/1'
}

async function renderOneOfOneArtwork(artwork, options = {}) {
  const image = artwork?.image
  if (!image?.naturalWidth || !image.naturalHeight) throw new Error(`Could not render ${getOneOfOneName(artwork)}.`)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  const exportCanvas = prepareCanvasForExport(canvas, options)
  try {
    return await canvasToBlob(exportCanvas, options.mime || 'image/png', options.quality)
  } finally {
    if (exportCanvas !== canvas) {
      exportCanvas.width = 0
      exportCanvas.height = 0
    }
    canvas.width = 0
    canvas.height = 0
  }
}

function prepareCanvasForExport(canvas, options = {}) {
  const limit = Number(options.maxDimension) || 0
  const canvasRatio = Number(options.canvasRatio) || 0
  const sourceLongestSide = Math.max(canvas.width, canvas.height)
  const outputLongestSide = limit ? Math.min(sourceLongestSide, limit) : sourceLongestSide

  let outputWidth
  let outputHeight
  if (canvasRatio > 0) {
    outputWidth = canvasRatio >= 1 ? outputLongestSide : outputLongestSide * canvasRatio
    outputHeight = canvasRatio >= 1 ? outputLongestSide / canvasRatio : outputLongestSide
  } else {
    const scale = outputLongestSide / sourceLongestSide
    outputWidth = canvas.width * scale
    outputHeight = canvas.height * scale
  }

  const targetWidth = Math.max(1, Math.round(outputWidth))
  const targetHeight = Math.max(1, Math.round(outputHeight))
  if (!canvasRatio && targetWidth === canvas.width && targetHeight === canvas.height) return canvas

  const prepared = document.createElement('canvas')
  prepared.width = targetWidth
  prepared.height = targetHeight
  const context = prepared.getContext('2d')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  if (options.mime === 'image/jpeg') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, targetWidth, targetHeight)
  }

  const fit = options.canvasFit === 'contain' ? 'contain' : 'cover'
  const scale = canvasRatio
    ? fit === 'contain'
      ? Math.min(targetWidth / canvas.width, targetHeight / canvas.height)
      : Math.max(targetWidth / canvas.width, targetHeight / canvas.height)
    : targetWidth / canvas.width
  const drawWidth = canvas.width * scale
  const drawHeight = canvas.height * scale
  context.drawImage(canvas, (targetWidth - drawWidth) / 2, (targetHeight - drawHeight) / 2, drawWidth, drawHeight)
  return prepared
}

function getProjectCanvasRatio(project) {
  const format = CANVAS_FORMATS[project.canvasFormat] || CANVAS_FORMATS.original
  if (format.ratio !== null) return format.ratio
  const width = clampNumber(project.customRatioWidth, 1, 100)
  const height = clampNumber(project.customRatioHeight, 1, 100)
  return width / height
}

function getOutputSizeHint(source, project) {
  if (!source?.width || !source.height) return 'Load artwork to calculate output dimensions.'
  const limit = clampNumber(project.maxDimension, 0, 12000)
  const sourceLongestSide = Math.max(source.width, source.height)
  const longestSide = limit ? Math.min(sourceLongestSide, limit) : sourceLongestSide
  const ratio = getProjectCanvasRatio(project)
  const width = ratio > 0
    ? ratio >= 1 ? longestSide : longestSide * ratio
    : source.width * (longestSide / sourceLongestSide)
  const height = ratio > 0
    ? ratio >= 1 ? longestSide / ratio : longestSide
    : source.height * (longestSide / sourceLongestSide)
  return `${Math.max(1, Math.round(width)).toLocaleString()} × ${Math.max(1, Math.round(height)).toLocaleString()} px${limit ? ' maximum' : ''}`
}

function canvasToBlob(canvas, mime = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not export canvas.'))
    }, mime, quality)
  })
}

function hasRenderableCanvas(layer) {
  if (layer?.canvas?.width && layer.canvas.height) return true
  return Boolean(layer?.rawData && Number(layer.right) > Number(layer.left) && Number(layer.bottom) > Number(layer.top))
}

function cleanName(value = 'Untitled') {
  return value
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function slugify(value) {
  return cleanName(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'trait-collection'
}

function clampNumber(value, min, max) {
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return min
  return Math.min(Math.max(Math.floor(parsed), min), max)
}

function clampDecimal(value, min, max) {
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return min
  return Math.min(Math.max(parsed, min), max)
}

function formatBytes(bytes) {
  if (!bytes) return '0 MB'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index < 2 ? 0 : 1)} ${units[index]}`
}

function waitForPaint() {
  return new Promise((resolve) => requestAnimationFrame(resolve))
}

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback
}

export default App
