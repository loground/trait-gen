import { useEffect, useMemo, useRef, useState } from 'react'
import { decodeLayerPixels, getLayerCanvas, readPsd } from 'ag-psd'
import JSZip from 'jszip'
import { getAddress } from 'viem'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Ban,
  Calculator,
  CheckCircle2,
  Eye,
  FolderOpen,
  ImagePlus,
  KeyRound,
  Layers3,
  Loader2,
  LogOut,
  Play,
  Plus,
  RotateCcw,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  Upload,
  Wallet,
  X,
} from 'lucide-react'
import './App.css'
import { findCombinationViolation, findInvalidCombination } from './ruleValidation.js'
import { buildSmartRarityProfile } from './smartRarities.js'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const LARGE_PSD_WARNING_SIZE = 100 * 1024 * 1024
const RETAINED_PSD_BITMAP_LIMIT = 512 * 1024 * 1024
const COMBO_COUNT_DISPLAY_LIMIT = 1000000
const COMBO_COUNT_TIME_BUDGET_MS = 32
const METADATA_FILE_NAME = 'metadata-file.csv'
const PREVIEW_DEBOUNCE_MS = 250
const PREVIEW_MAX_DIMENSION = 1024
const PREVIEW_BACKGROUNDS = ['#ffffff', '#d6dbe3', '#111827']
const HOODCHAN_CONTRACT_ADDRESS = '0x774db2207d26570f5638028839c816702a40abc2'
const HOODCHAN_COLLECTION_URL = 'https://opensea.io/collection/h00dchan'
const ROBINHOOD_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com'
const GENERATION_CODE_URL = '/api/codes/redeem'
const INTRO_ACCEPTED_KEY = 'trait-forge:intro-accepted:v1'
const TOKEN_GATE_ENABLED = false
const OUTPUT_FORMATS = {
  png: { mime: 'image/png', extension: 'png', label: 'PNG' },
  webp: { mime: 'image/webp', extension: 'webp', label: 'WebP' },
  jpeg: { mime: 'image/jpeg', extension: 'jpg', label: 'JPEG' },
}
const DEFAULT_PROJECT = {
  name: 'Trait Collection',
  description: 'Generated with Trait Forge',
  imagePrefix: 'ipfs://CID/',
  count: 2000,
  startAt: 1,
  seed: 'trait-forge',
  mode: 'random',
  outputFormat: 'webp',
  quality: 0.86,
  maxDimension: 2048,
}

const emptyRuleDraft = { first: '', second: '' }
const emptyRuleFolderDraft = { first: '', second: '' }
const emptyPositionRuleDraft = { first: '', second: '', firstX: 0, firstY: 0, secondX: 0, secondY: 0 }
const emptyConditionDraft = { category: '', requiredTrait: '' }
const emptyFolderConflictDraft = { first: '', second: '' }

function App() {
  const [project, setProject] = useState(DEFAULT_PROJECT)
  const [source, setSource] = useState(null)
  const [status, setStatus] = useState('Drop in a PSD or trait folders to begin.')
  const [busy, setBusy] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [samplePreviews, setSamplePreviews] = useState([])
  const [samplePreviewOpen, setSamplePreviewOpen] = useState(false)
  const [previewBackground, setPreviewBackground] = useState('#ffffff')
  const [walletGate, setWalletGate] = useState({ status: 'idle', address: '', balance: 0, message: '' })
  const [introOpen, setIntroOpen] = useState(() => readStoredValue(INTRO_ACCEPTED_KEY) !== 'yes')
  const [accessOpen, setAccessOpen] = useState(false)
  const [accessBusy, setAccessBusy] = useState(false)
  const [accessMessage, setAccessMessage] = useState('')
  const [generationCode, setGenerationCode] = useState('')
  const [account, setAccount] = useState({ status: 'loading', walletAddress: '', credits: 0 })
  const [lastZipUrl, setLastZipUrl] = useState('')
  const [lastZipName, setLastZipName] = useState('')
  const [selectedCategoryIndex, setSelectedCategoryIndex] = useState(0)
  const [selectedTraitIndex, setSelectedTraitIndex] = useState(0)
  const [traitEditorOpen, setTraitEditorOpen] = useState(false)
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
  const traitFilesInputRef = useRef(null)
  const traitUploadCategoryRef = useRef(null)
  const baseFileRef = useRef(null)
  const previewTimerRef = useRef(null)
  const previewRequestRef = useRef(0)
  const samplePreviewUrlsRef = useRef([])
  const managerPreviewUrlsRef = useRef({})
  const managerPreviewSignaturesRef = useRef({})
  const managerPairPreviewUrlRef = useRef('')
  const traitEditorPreviewUrlRef = useRef('')
  const traitPreviewDragRef = useRef(null)
  const positionCanvasDragRef = useRef(null)
  const draggedTraitRef = useRef(null)
  const traitFolderDragOccurredRef = useRef(false)
  const walletCheckRef = useRef(0)
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
      if (response.status === 401) {
        setAccount({ status: 'anonymous', walletAddress: '', credits: 0 })
        return null
      }
      if (!response.ok) throw new Error('Could not load generation credits.')
      const result = await response.json()
      const nextAccount = {
        status: 'authenticated',
        walletAddress: result.walletAddress,
        credits: Math.max(0, Number(result.credits) || 0),
      }
      setAccount(nextAccount)
      return nextAccount
    } catch {
      setAccount({ status: 'unavailable', walletAddress: '', credits: 0 })
      return null
    }
  }

  async function authenticateWallet() {
    const provider = window.ethereum
    if (!provider?.request) throw new Error('Install or open an EVM wallet to redeem a generation code.')
    const accounts = await provider.request({ method: 'eth_requestAccounts' })
    if (!accounts?.[0]) throw new Error('No wallet account was selected.')
    const address = getAddress(accounts[0])
    if (account.status === 'authenticated' && account.walletAddress.toLowerCase() === address.toLowerCase()) return address

    const nonceResponse = await fetch('/api/auth/nonce', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
    })
    if (!nonceResponse.ok) throw new Error(await readResponseError(nonceResponse, 'Could not start wallet sign-in.'))
    const nonceResult = await nonceResponse.json()
    const chainId = Number.parseInt(await provider.request({ method: 'eth_chainId' }), 16)
    const issuedAt = new Date()
    const message = buildSiweMessage({
      domain: window.location.host,
      address,
      statement: 'Sign in to Trait Forge to redeem and use generation codes.',
      uri: window.location.origin,
      version: '1',
      chainId,
      nonce: nonceResult.nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: new Date(issuedAt.getTime() + 10 * 60 * 1000).toISOString(),
    })
    const signature = await provider.request({ method: 'personal_sign', params: [message, address] })
    const verifyResponse = await fetch('/api/auth/verify', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, signature, nonceId: nonceResult.nonceId }),
    })
    if (!verifyResponse.ok) throw new Error(await readResponseError(verifyResponse, 'Wallet sign-in failed.'))
    await loadAccount()
    return address
  }

  async function authorizeAndGenerate({ authenticated = false } = {}) {
    setAccessBusy(true)
    setAccessMessage('Authorizing one generation credit…')
    try {
      if (!authenticated) await authenticateWallet()
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
      await authenticateWallet()
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
      await authorizeAndGenerate({ authenticated: true })
    } catch (error) {
      setAccessMessage(getErrorMessage(error, 'Could not redeem that code.'))
    } finally {
      setAccessBusy(false)
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
  const samplePreviewCount = source ? Math.min(16, Math.max(1, maxEditions)) : 16

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

  async function verifyWalletAccess(address) {
    const requestId = walletCheckRef.current + 1
    walletCheckRef.current = requestId
    setWalletGate({ status: 'checking', address, balance: 0, message: 'Checking HOODCHAN ownership...' })
    try {
      const balance = await readHoodchanBalance(address)
      if (requestId !== walletCheckRef.current) return false
      if (balance > 0n) {
        setWalletGate({ status: 'holder', address, balance: Number(balance), message: '' })
        return true
      }
      setWalletGate({ status: 'denied', address, balance: 0, message: 'This wallet does not hold a HOODCHAN NFT.' })
      return false
    } catch (error) {
      if (requestId !== walletCheckRef.current) return false
      setWalletGate({ status: 'error', address, balance: 0, message: getErrorMessage(error, 'Could not verify NFT ownership.') })
      return false
    }
  }

  async function connectWallet() {
    const provider = window.ethereum
    if (!provider?.request) {
      setWalletGate({ status: 'error', address: '', balance: 0, message: 'Open this page in an EVM wallet browser or install a browser wallet.' })
      return
    }
    setWalletGate((current) => ({ ...current, status: 'connecting', message: 'Connecting wallet...' }))
    try {
      if (walletGate.address) {
        try {
          await provider.request({
            method: 'wallet_requestPermissions',
            params: [{ eth_accounts: {} }],
          })
        } catch (permissionError) {
          if (permissionError?.code === 4001) throw permissionError
          const unsupportedPermissionMethod = [-32601, -32004, 4200].includes(permissionError?.code)
          if (!unsupportedPermissionMethod) throw permissionError
        }
      }
      const accounts = await provider.request({ method: 'eth_requestAccounts' })
      const address = accounts?.[0]
      if (!address) throw new Error('No wallet account was selected.')
      await verifyWalletAccess(address)
    } catch (error) {
      const message = error?.code === 4001 ? 'Wallet connection was cancelled.' : getErrorMessage(error, 'Could not connect the wallet.')
      setWalletGate({ status: 'error', address: '', balance: 0, message })
    }
  }

  async function disconnectWallet() {
    walletCheckRef.current += 1
    const provider = window.ethereum
    try {
      await provider?.request?.({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      })
    } catch {
      // Some injected wallets do not support permission revocation. The local
      // session is still cleared so the token gate closes immediately.
    }
    setWalletGate({ status: 'idle', address: '', balance: 0, message: '' })
  }

  async function ensureHolderAccess() {
    if (!TOKEN_GATE_ENABLED) return true
    if (walletGate.status !== 'holder' || !walletGate.address) return false
    try {
      const balance = await readHoodchanBalance(walletGate.address)
      if (balance > 0n) return true
      setWalletGate({ status: 'denied', address: walletGate.address, balance: 0, message: 'This wallet no longer holds a HOODCHAN NFT.' })
    } catch (error) {
      setWalletGate({ status: 'error', address: walletGate.address, balance: 0, message: getErrorMessage(error, 'Could not verify NFT ownership.') })
    }
    return false
  }

  useEffect(() => {
    loadAccount()
  }, [])

  useEffect(() => {
    if (!TOKEN_GATE_ENABLED) return undefined
    const provider = window.ethereum
    if (!provider?.request) return undefined
    let active = true
    const handleAccountsChanged = (accounts = []) => {
      walletCheckRef.current += 1
      const address = accounts[0]
      if (!address) {
        setWalletGate({ status: 'idle', address: '', balance: 0, message: '' })
        return
      }
      verifyWalletAccess(address)
    }

    provider.request({ method: 'eth_accounts' })
      .then((accounts) => {
        if (active && accounts?.[0]) verifyWalletAccess(accounts[0])
      })
      .catch(() => {})
    provider.on?.('accountsChanged', handleAccountsChanged)
    return () => {
      active = false
      provider.removeListener?.('accountsChanged', handleAccountsChanged)
    }
  }, [])

  useEffect(
    () => () => {
      if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current)
      previewRequestRef.current += 1
      Object.values(managerPreviewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url))
      if (managerPairPreviewUrlRef.current) URL.revokeObjectURL(managerPairPreviewUrlRef.current)
      if (traitEditorPreviewUrlRef.current) URL.revokeObjectURL(traitEditorPreviewUrlRef.current)
      samplePreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
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

  async function importPsdFile(file) {
    if (!file) return
    if (!(await ensureHolderAccess())) return
    if (!file.name.toLowerCase().endsWith('.psd') && file.type !== 'image/vnd.adobe.photoshop') {
      setStatus('Drop a PSD file into Single PSD.')
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

  async function handlePsdUpload(event) {
    const file = event.target.files?.[0]
    await importPsdFile(file)
    event.target.value = ''
  }

  async function selectBaseFile(file) {
    if (!file) return
    if (!(await ensureHolderAccess())) return
    if (!IMAGE_TYPES.includes(file.type)) {
      setStatus('Drop a PNG, JPG, or WebP image into Base image.')
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
    if (target === 'psd') await importPsdFile(file)
    if (target === 'base') await selectBaseFile(file)
    if (target === 'preview') {
      if (file.name.toLowerCase().endsWith('.psd') || file.type === 'image/vnd.adobe.photoshop') {
        await importPsdFile(file)
      } else if (IMAGE_TYPES.includes(file.type)) {
        await selectBaseFile(file)
      } else {
        setStatus('Drop a PSD, PNG, JPG, or WebP file into the preview area.')
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

  function chooseTraitFiles(categoryIndex) {
    if (!source || busy || !source.categories[categoryIndex]) return
    traitUploadCategoryRef.current = categoryIndex
    traitFilesInputRef.current?.click()
  }

  async function handleTraitFilesUpload(event) {
    const files = Array.from(event.target.files || [])
    const categoryIndex = traitUploadCategoryRef.current
    event.target.value = ''
    traitUploadCategoryRef.current = null
    if (!files.length || !source || categoryIndex === null || !source.categories[categoryIndex]) return
    if (!(await ensureHolderAccess())) return

    const imageFiles = files.filter((file) => IMAGE_TYPES.includes(file.type))
    if (!imageFiles.length) {
      setStatus('Choose PNG, JPG, or WebP trait images.')
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

  async function randomizeTraitRarities() {
    if (!source || busy) return
    const targetCount = Math.max(1, Math.round(Number(project.count) || 2000))
    const profile = buildSmartRarityProfile(source.categories, {
      targetCount,
      seed: `${project.seed}:${Date.now()}:${Math.random()}`,
    })
    let categories = profile.categories
    let validCombinationInfo = countValidCombinations(getActiveCategories(categories), getSourceRules(source), COMBO_COUNT_DISPLAY_LIMIT)

    // Small sources sometimes need an additional None choice to reach the target.
    // Add it first to non-core groups where omission changes the artwork least.
    if (!validCombinationInfo.capped && validCombinationInfo.count < targetCount) {
      const candidates = categories
        .map((category, index) => ({ category, index }))
        .filter(({ category }) => category.enabled !== false && !getCategoryNoneWeight(category))
        .sort((first, second) => first.category.traits.length - second.category.traits.length)
      for (const candidate of candidates) {
        categories = categories.map((category, index) =>
          index === candidate.index ? addNoTraitChance(category, 12) : category,
        )
        validCombinationInfo = countValidCombinations(getActiveCategories(categories), getSourceRules(source), COMBO_COUNT_DISPLAY_LIMIT)
        if (validCombinationInfo.capped || validCombinationInfo.count >= targetCount) break
      }
    }

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
    setStatus(
      `Smart rarity plan for ${targetCount.toLocaleString()} editions: ${profile.summary.optionalCategoryCount} optional folders, ${profile.summary.rareTraitCount} ultra-rare traits, about ${profile.summary.lowestExpectedCount} copies of the rarest trait, and ${capacity} valid combinations.${duplicateWarning}`,
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
    }))
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

  async function addPositionRule() {
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
      secondOffsetX: Number(positionRuleDraft.secondX) || 0,
      secondOffsetY: Number(positionRuleDraft.secondY) || 0,
    }
    if (rule.first.localeCompare(rule.second) > 0) {
      rule = {
        first: rule.second,
        second: rule.first,
        firstOffsetX: rule.secondOffsetX,
        firstOffsetY: rule.secondOffsetY,
        secondOffsetX: rule.firstOffsetX,
        secondOffsetY: rule.firstOffsetY,
      }
    }
    const existingRules = source.positionRules || []
    if (existingRules.some((existingRule) => makeRuleKey(existingRule) === makeRuleKey(rule))) {
      setStatus('That pair already has a position rule.')
      return
    }
    const nextSource = { ...source, positionRules: [...existingRules, rule] }
    setSource(nextSource)
    setPositionRuleDraft(emptyPositionRuleDraft)
    setPositionRuleFolderDraft(emptyRuleFolderDraft)
    setStatus('Pair-specific position rule added.')
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
    if (!source || busy || !conditionDraft.category || !conditionDraft.requiredTrait) return
    const existingRules = source.categoryRequirements || []
    if (existingRules.some((rule) => rule.category === conditionDraft.category)) {
      setStatus(`${conditionDraft.category} already has a folder rule.`)
      return
    }

    const nextSource = {
      ...source,
      categoryRequirements: [...existingRules, { ...conditionDraft }],
    }
    setSource(nextSource)
    setConditionDraft(emptyConditionDraft)
    setStatus('Folder rule added.')
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
    if (!source || busy || !folderConflictDraft.first || !folderConflictDraft.second || folderConflictDraft.first === folderConflictDraft.second) return
    const [first, second] = normalizeRule(folderConflictDraft.first, folderConflictDraft.second)
    const ruleKey = `${first}||${second}`
    const existingRules = source.categoryConflicts || []
    if (existingRules.some((rule) => makeRuleKey(rule) === ruleKey)) {
      setStatus('That folder conflict already exists.')
      return
    }

    const nextSource = {
      ...source,
      categoryConflicts: [...existingRules, { first, second }],
    }
    setSource(nextSource)
    setFolderConflictDraft(emptyFolderConflictDraft)
    setStatus('Folder conflict added.')
    await renderPreview(nextSource)
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
    setSamplePreviews([])
  }

  function closeSamplePreview() {
    setSamplePreviewOpen(false)
    clearSamplePreviews()
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
      const combos = project.mode === 'all'
        ? buildCombinationsUpTo(activeCategories, rules, sampleCount)
        : buildUniqueRandomCombinations(activeCategories, sampleCount, project.seed, rules)
      if (!combos.length) throw new Error('No valid sample combinations could be selected.')

      const previews = []
      for (let index = 0; index < combos.length; index += 1) {
        const blob = await renderArtwork(source, combos[index], { renderMaxDimension: 420 })
        const url = URL.createObjectURL(blob)
        createdUrls.push(url)
        previews.push({
          url,
          edition: Number(project.startAt) + index,
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
      setStatus(`Preview ready. These ${previews.length} samples use the current seed, rarities, and trait rules.`)
    } catch (error) {
      createdUrls.forEach((url) => URL.revokeObjectURL(url))
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
      const metadataCategories = activeCategories.map((category) => category.name)
      const metadataRows = []
      const manifest = []
      const combos =
        project.mode === 'all'
          ? buildCombinationsUpTo(activeCategories, rules, targetCount)
          : buildUniqueRandomCombinations(activeCategories, targetCount, project.seed, rules)

      if (combos.length !== targetCount) {
        throw new Error(`Only ${combos.length} unique valid combinations could be selected. Requested ${targetCount}.`)
      }
      const invalidCombination = findInvalidCombination(combos, rules)
      if (invalidCombination) {
        throw new Error(`Rule validation stopped generation at edition ${Number(project.startAt) + invalidCombination.index}: ${invalidCombination.reason}`)
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
            validationPassed: true,
          },
          null,
          2,
        ),
      )

      for (let index = 0; index < combos.length; index += 1) {
        const edition = Number(project.startAt) + index
        const violation = findCombinationViolation(combos[index], rules)
        if (violation) {
          throw new Error(`Rule validation stopped generation at edition ${edition}: ${violation}`)
        }
        const blob = await renderArtwork(source, combos[index], {
          mime: output.mime,
          quality,
          maxDimension,
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

      zip.file(METADATA_FILE_NAME, buildMetadataCsv(metadataCategories, metadataRows))
      zip.file('manifest.json', JSON.stringify(manifest, null, 2))
      const zipBlob = await zip.generateAsync({
        type: 'blob',
        streamFiles: true,
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      })
      const zipUrl = URL.createObjectURL(zipBlob)
      const zipName = `${slugify(project.name)}-nft-drop.zip`
      setLastZipUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return zipUrl
      })
      setLastZipName(zipName)
      setStatus(`Done. ${combos.length} ${output.label} images and ${METADATA_FILE_NAME} are ready.`)
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
    URL.revokeObjectURL(url)
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

  function useMaxEditions() {
    if (!maxEditions || maxEditionsCapped) return
    setProject((current) => ({ ...current, count: maxEditions }))
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
  const traitEditorCategory = selectedCategory || source?.categories?.[0] || null
  const traitEditorCategoryIndex = source?.categories?.length ? Math.min(selectedCategoryIndex, source.categories.length - 1) : 0
  const traitEditorTraitIndex = traitEditorCategory?.traits?.length ? Math.min(selectedTraitIndex, traitEditorCategory.traits.length - 1) : 0
  const traitEditorTrait = traitEditorCategory?.traits?.[traitEditorTraitIndex] || null
  const totalTraitCount = source?.categories?.reduce((total, category) => total + category.traits.length, 0) || 0
  const positionFirstTrait = source ? findTraitByKey(source, positionRuleDraft.first) : null
  const positionSecondTrait = source ? findTraitByKey(source, positionRuleDraft.second) : null

  function getPositionCanvasTransform(side, trait) {
    if (!source || !trait) return 'none'
    const offsetX = Number(positionRuleDraft[`${side}X`]) || 0
    const offsetY = Number(positionRuleDraft[`${side}Y`]) || 0
    const deltaX = offsetX - getTraitOffset(trait, 'x')
    const deltaY = offsetY - getTraitOffset(trait, 'y')
    return `translate(${(deltaX / source.width) * 100}%, ${(deltaY / source.height) * 100}%)`
  }

  if (TOKEN_GATE_ENABLED && walletGate.status !== 'holder') {
    const checkingWallet = walletGate.status === 'connecting' || walletGate.status === 'checking'
    const choosingAnotherWallet = Boolean(walletGate.address)
    return (
      <main className="wallet-gate-shell">
        <section className="wallet-gate-card" aria-live="polite">
          <div className="wallet-gate-icon"><Wallet size={30} /></div>
          <p className="eyebrow">HOODCHAN holders only</p>
          <h1>Connect to enter Trait Forge</h1>
          <p className="wallet-gate-description">Hold at least one HOODCHAN NFT in the connected wallet to upload traits and generate a collection.</p>
          {walletGate.address && <code className="wallet-address">{formatWalletAddress(walletGate.address)}</code>}
          {walletGate.message && <p className={`wallet-gate-message ${walletGate.status}`}>{walletGate.message}</p>}
          <button
            className="wallet-connect-action"
            type="button"
            disabled={checkingWallet}
            onClick={connectWallet}
          >
            {checkingWallet ? <Loader2 className="spin" size={18} /> : <Wallet size={18} />}
            {checkingWallet ? 'Connecting wallet...' : choosingAnotherWallet ? 'Choose another wallet' : 'Connect wallet'}
          </button>
          <a className="wallet-buy-link" href={HOODCHAN_COLLECTION_URL} target="_blank" rel="noreferrer">
            Buy HOODCHAN on OpenSea
          </a>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell" style={{ '--preview-background': previewBackground }}>
      <section className="topbar">
        <div>
          <p className="eyebrow">NFT trait combiner</p>
          <h1>Trait Forge</h1>
        </div>
        <div className="topbar-actions">
          <div className="status-pill">
            {busy ? <Loader2 className="spin" size={17} /> : <CheckCircle2 size={17} />}
            <span>{status}</span>
          </div>
          {TOKEN_GATE_ENABLED && (
            <div className="wallet-session">
              <Wallet size={16} />
              <div>
                <code>{formatWalletAddress(walletGate.address)}</code>
                <span>{walletGate.balance} HOODCHAN</span>
              </div>
              <button type="button" onClick={disconnectWallet} aria-label="Disconnect wallet">
                <LogOut size={16} />
                Disconnect
              </button>
            </div>
          )}
          {account.status === 'authenticated' && (
            <div className="wallet-session">
              <Wallet size={16} />
              <div>
                <code>{formatWalletAddress(account.walletAddress)}</code>
                <span>{account.credits} generation credit{account.credits === 1 ? '' : 's'}</span>
              </div>
            </div>
          )}
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
              <strong>Single PSD</strong>
              <small>Drop a PSD here, or click to browse.</small>
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
          <button className="backup-action" type="button" onClick={chooseProjectBackup} disabled={busy || !source}>
            <Archive size={18} />
            Restore project backup
          </button>
          <p className="chance-note">Load the matching PSD or trait folder first, then restore its JSON backup.</p>

          <input ref={psdInputRef} className="hidden" type="file" accept=".psd,image/vnd.adobe.photoshop" onChange={handlePsdUpload} />
          <input ref={baseInputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleBaseUpload} />
          <input ref={folderInputRef} className="hidden" type="file" webkitdirectory="true" directory="" multiple onChange={handleFolderUpload} />
          <input ref={traitFilesInputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={handleTraitFilesUpload} />

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
              <p className="empty-state">Upload one layered PSD, or choose a base image and one directory containing trait folders.</p>
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
              <span>Drop a PSD or base image here.</span>
              <small>PNG, JPG, and WebP are supported.</small>
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
            Image URI prefix
            <input value={project.imagePrefix} onChange={(event) => updateProject('imagePrefix', event.target.value)} />
          </label>

          <div className="field-grid">
            <label>
              Editions
              <div className="input-with-action">
                <input type="number" min="1" max={maxEditionsCapped ? undefined : maxEditions || undefined} value={project.count} onChange={(event) => updateProject('count', event.target.value)} />
                <button type="button" disabled={!maxEditions || maxEditionsCapped || busy} onClick={useMaxEditions} aria-label="Use maximum editions">
                  <Calculator size={16} />
                  Max
                </button>
              </div>
              <span className="field-hint">
                {maxEditionsInfo.approximate
                  ? `${formatComboCount(maxEditionsInfo)} — live counting paused to keep editing fast.`
                  : maxEditions
                    ? `${editionFormula} = ${formatComboCount(maxEditionsInfo)} maximum`
                    : 'Load traits to calculate the maximum.'}
              </span>
            </label>
            <label>
              Start at
              <input type="number" min="0" value={project.startAt} onChange={(event) => updateProject('startAt', event.target.value)} />
            </label>
          </div>

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
            {project.mode === 'random' ? 'Uses the seed to pick unique combinations.' : 'Walks through every possible combination until Editions is reached.'}
          </span>

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
            Max image side
            <input type="number" min="0" max="12000" value={project.maxDimension} onChange={(event) => updateProject('maxDimension', event.target.value)} />
            <span className="field-hint">Use 0 for original size.</span>
          </label>

          <button className="sample-preview-action" type="button" onClick={generateSamplePreview} disabled={busy || !source}>
            {busy && samplePreviewOpen ? <Loader2 className="spin" size={18} /> : <Eye size={18} />}
            Preview {samplePreviewCount} {samplePreviewCount === 1 ? 'sample' : 'samples'}
          </button>

          <button className="primary-action" type="button" onClick={startGeneration} disabled={busy || !source}>
            {busy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
            {account.credits > 0
              ? `Generate ZIP · ${account.credits} credit${account.credits === 1 ? '' : 's'}`
              : 'Enter code to generate ZIP'}
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
              ZIP generation requires a valid generation code. Codes grant free generation credits and no payment is requested.
            </div>
            <button className="primary-action" type="button" onClick={acceptIntro}>
              <CheckCircle2 size={18} />
              I understand and agree
            </button>
          </section>
        </div>
      )}

      {accessOpen && (
        <div className="modal-backdrop payment-backdrop" role="presentation">
          <section className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="access-title">
            <header className="modal-header">
              <div>
                <p className="eyebrow">Generation access</p>
                <h2 id="access-title">Enter a generation code</h2>
              </div>
              <button type="button" aria-label="Close generation access" disabled={accessBusy} onClick={() => setAccessOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <div className="payment-panel">
              <form className="payment-option-content" onSubmit={redeemGenerationCode}>
                <div className="payment-option-heading">
                  <span className="payment-option-icon"><KeyRound size={24} /></span>
                  <div>
                    <h3>Redeem your code</h3>
                    <p>Your wallet signs a free message so credits remain available on future visits.</p>
                  </div>
                </div>
                <label>
                  Generation code
                  <input type="text" autoComplete="off" placeholder="TF-…" value={generationCode} disabled={accessBusy} onChange={(event) => setGenerationCode(event.target.value)} />
                </label>
                <button className="primary-action" type="submit" disabled={accessBusy}>
                  {accessBusy ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
                  Apply code and generate
                </button>
                {accessMessage && <p className="payment-message" aria-live="polite">{accessMessage}</p>}
              </form>
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
              <button type="button" aria-label="Close sample preview" disabled={busy} onClick={closeSamplePreview}>
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
              Samples use the current seed, rarities, positions, and compatibility rules. Nothing is downloaded yet.
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
                <button
                  className="modal-add-traits-action"
                  type="button"
                  disabled={busy || !traitEditorCategory}
                  onClick={() => chooseTraitFiles(traitEditorCategoryIndex)}
                >
                  <ImagePlus size={16} />
                  Add traits
                </button>
                <button className="modal-rarity-action" type="button" disabled={busy} onClick={randomizeTraitRarities}>
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
                  <div>
                    <p className="eyebrow">Selected folder</p>
                    <h3>{traitEditorCategory?.name}</h3>
                  </div>
                  <div className="selected-folder-controls">
                    <span>{traitEditorCategory?.traits.length || 0} traits</span>
                    <label className="folder-none-chance">
                      No trait chance
                      <div className="input-with-suffix">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={traitEditorCategory?.noneWeight ?? 0}
                          disabled={busy || traitEditorCategory?.enabled === false}
                          onChange={(event) => updateCategoryNoneWeight(traitEditorCategoryIndex, event.target.value)}
                        />
                        <span>%</span>
                      </div>
                    </label>
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
                      <small>Rarity {getTraitWeight(trait)}% · Position X {getTraitOffset(trait, 'x')} · Position Y {getTraitOffset(trait, 'y')}</small>
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
                      <label>
                        Chance
                        <div className="input-with-suffix">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={traitEditorTrait.weight ?? 1}
                            disabled={busy || traitEditorCategory.enabled === false}
                            onChange={(event) => updateTraitWeight(traitEditorCategoryIndex, traitEditorTraitIndex, event.target.value)}
                          />
                          <span>%</span>
                        </div>
                      </label>
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
                <p>Use special X/Y positions only when two selected traits appear together.</p>
                <div className="trait-picker-field">
                  <label>
                    First folder
                    <select
                      value={positionRuleFolderDraft.first}
                      disabled={busy}
                      onChange={(event) => {
                        setPositionRuleFolderDraft((current) => ({ ...current, first: event.target.value }))
                        selectPositionRuleTrait('first', '')
                      }}
                    >
                      <option value="">Choose folder</option>
                      {source.categories.map((category, categoryIndex) => (
                        <option value={categoryIndex} disabled={String(categoryIndex) === positionRuleFolderDraft.second} key={`${category.name}-${categoryIndex}`}>{category.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    First trait
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
                    onChange={(axis, value) => updatePositionRuleOffset('first', axis, value)}
                  />
                </div>
                <div className="trait-picker-field">
                  <label>
                    Second folder
                    <select
                      value={positionRuleFolderDraft.second}
                      disabled={busy}
                      onChange={(event) => {
                        setPositionRuleFolderDraft((current) => ({ ...current, second: event.target.value }))
                        selectPositionRuleTrait('second', '')
                      }}
                    >
                      <option value="">Choose folder</option>
                      {source.categories.map((category, categoryIndex) => (
                        <option value={categoryIndex} disabled={String(categoryIndex) === positionRuleFolderDraft.first} key={`${category.name}-${categoryIndex}`}>{category.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Second trait
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
                    onChange={(axis, value) => updatePositionRuleOffset('second', axis, value)}
                  />
                </div>
                {positionRuleDraft.first && positionRuleDraft.second && (
                  <div className="pair-position-preview interactive-position-preview">
                    <div className="pair-position-preview-header">
                      <span>Drag to position both traits</span>
                      <small>Select a trait, then drag it in the canvas</small>
                    </div>
                    <div className="position-preview-trait-tabs" role="group" aria-label="Trait to reposition">
                      <button
                        className={activePositionTraitSide === 'first' ? 'active' : ''}
                        type="button"
                        onClick={() => setActivePositionTraitSide('first')}
                      >
                        <span>First trait</span>
                        <strong>{traitOptionMap.get(positionRuleDraft.first)?.split(' / ').at(-1)}</strong>
                        <small>X {Number(positionRuleDraft.firstX) || 0} · Y {Number(positionRuleDraft.firstY) || 0}</small>
                      </button>
                      <button
                        className={activePositionTraitSide === 'second' ? 'active' : ''}
                        type="button"
                        onClick={() => setActivePositionTraitSide('second')}
                      >
                        <span>Second trait</span>
                        <strong>{traitOptionMap.get(positionRuleDraft.second)?.split(' / ').at(-1)}</strong>
                        <small>X {Number(positionRuleDraft.secondX) || 0} · Y {Number(positionRuleDraft.secondY) || 0}</small>
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
                <button
                  className="rule-add"
                  type="button"
                  disabled={busy || !positionRuleDraft.first || !positionRuleDraft.second || positionRuleDraft.first === positionRuleDraft.second}
                  onClick={addPositionRule}
                >
                  <SlidersHorizontal size={16} />
                  Add position rule
                </button>
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
                <p>Only apply an entire folder when a specific trait is selected.</p>
                <label>
                  Folder
                  <select value={conditionDraft.category} disabled={busy} onChange={(event) => setConditionDraft((current) => ({ ...current, category: event.target.value }))}>
                    <option value="">Choose folder</option>
                    {source.categories.map((category, index) => <option value={category.name} key={`${category.name}-${index}`}>{category.name}</option>)}
                  </select>
                </label>
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
                <button className="rule-add" type="button" disabled={busy || !conditionDraft.category || !conditionDraft.requiredTrait} onClick={addCategoryRequirement}>
                  <Ban size={16} />
                  Add folder rule
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
                <p>Prevent two entire folders from rendering in the same image.</p>
                <label>
                  First folder
                  <select value={folderConflictDraft.first} disabled={busy} onChange={(event) => setFolderConflictDraft((current) => ({ ...current, first: event.target.value }))}>
                    <option value="">Choose folder</option>
                    {source.categories.map((category, index) => <option value={category.name} key={`${category.name}-${index}`}>{category.name}</option>)}
                  </select>
                </label>
                <label>
                  Cannot appear with
                  <select value={folderConflictDraft.second} disabled={busy} onChange={(event) => setFolderConflictDraft((current) => ({ ...current, second: event.target.value }))}>
                    <option value="">Choose folder</option>
                    {source.categories.map((category, index) => <option value={category.name} key={`${category.name}-${index}`}>{category.name}</option>)}
                  </select>
                </label>
                <button className="rule-add" type="button" disabled={busy || !folderConflictDraft.first || !folderConflictDraft.second || folderConflictDraft.first === folderConflictDraft.second} onClick={addCategoryConflict}>
                  <Ban size={16} />
                  Add folder conflict
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

function buildSiweMessage({ domain, address, statement, uri, version, chainId, nonce, issuedAt, expirationTime }) {
  return `${domain} wants you to sign in with your Ethereum account:\n${address}\n\n${statement}\n\nURI: ${uri}\nVersion: ${version}\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expirationTime}`
}

function writeStoredValue(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Access still works for this tab when browser storage is unavailable.
  }
}

async function readResponseError(response, fallback) {
  try {
    const payload = await response.json()
    return payload?.message || payload?.error || fallback
  } catch {
    return fallback
  }
}

async function readHoodchanBalance(address) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address || '')) throw new Error('The connected wallet address is invalid.')
  const data = `0x70a08231${address.slice(2).toLowerCase().padStart(64, '0')}`
  const response = await fetch(ROBINHOOD_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: HOODCHAN_CONTRACT_ADDRESS, data }, 'latest'],
    }),
  })
  if (!response.ok) throw new Error('Robinhood Chain did not respond to the ownership check.')
  const payload = await response.json()
  if (payload.error) throw new Error(payload.error.message || 'The ownership check failed.')
  if (!/^0x[a-fA-F0-9]+$/.test(payload.result || '')) throw new Error('The ownership check returned an invalid balance.')
  return BigInt(payload.result)
}

function formatWalletAddress(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ''
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

function PairPositionDraftControls({ traitKey, label, offsetX, offsetY, onChange }) {
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
  const restoredCategories = []
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

    restoredCategories.push({
      ...currentCategory.category,
      name: backupCategory.name,
      enabled: backupCategory.enabled !== false,
      noneWeight: clampDecimal(backupCategory.noneWeight, 0, 100),
      traits: mergedTraits,
    })
  }

  if (unusedCategories.size) {
    throw new Error('The loaded source contains groups that are not present in this backup.')
  }

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
    secondOffsetX: Math.round(Number(rule.secondOffsetX) || 0),
    secondOffsetY: Math.round(Number(rule.secondOffsetY) || 0),
  }))
  const restoredSource = {
    ...source,
    categories: restoredCategories,
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

  return {
    project: { ...DEFAULT_PROJECT, ...backup.project },
    source: restoredSource,
    traitCount: backup.source.categories.reduce((total, category) => total + category.traits.length, 0),
    skippedTraitCount:
      restoredCategories.reduce((total, category) => total + category.traits.length, 0) -
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
    .filter((file) => IMAGE_TYPES.includes(file.type))
    .sort((first, second) => (first.webkitRelativePath || first.name).localeCompare(second.webkitRelativePath || second.name))
  if (!imageFiles.length) {
    throw new Error('No PNG, JPG, or WebP trait images found in the selected folder.')
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
      const position = positionOverrides.get(getTraitId(trait)) || { x: getTraitOffset(trait, 'x'), y: getTraitOffset(trait, 'y') }
      if (trait.type === 'image') {
        context.drawImage(trait.image, position.x, position.y, source.width, source.height)
      } else {
        for (const layer of trait.layers) {
          drawPsdLayer(context, layer, position.x, position.y)
        }
      }
    }
  } else {
    if (includeBase && source.baseImage) context.drawImage(source.baseImage, 0, 0, source.width, source.height)
    for (const trait of traits) {
      if (trait.isNone) continue
      const position = positionOverrides.get(getTraitId(trait)) || { x: getTraitOffset(trait, 'x'), y: getTraitOffset(trait, 'y') }
      context.drawImage(trait.image, position.x, position.y, source.width, source.height)
    }
  }

  const exportCanvas = resizeCanvasForExport(canvas, options.maxDimension)
  return canvasToBlob(exportCanvas, options.mime || 'image/png', options.quality)
}

function getPairPositionOverrides(traits, positionRules = []) {
  const selectedTraitIds = new Set(traits.filter((trait) => !trait.isNone).map((trait) => getTraitId(trait)))
  const overrides = new Map()
  for (const rule of positionRules || []) {
    if (!selectedTraitIds.has(rule.first) || !selectedTraitIds.has(rule.second)) continue
    overrides.set(rule.first, { x: Math.round(Number(rule.firstOffsetX) || 0), y: Math.round(Number(rule.firstOffsetY) || 0) })
    overrides.set(rule.second, { x: Math.round(Number(rule.secondOffsetX) || 0), y: Math.round(Number(rule.secondOffsetY) || 0) })
  }
  return overrides
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
    const combo = buildRandomCombination(categories, seed, attempt, rules)
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
  if (combos.length < count) {
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

function buildRandomCombination(categories, seed, index, rules = {}) {
  const random = mulberry32(hashString(`${seed}:${index}`))
  const combo = []
  for (const category of categories) {
    if (!shouldApplyCategory(category, combo, rules.categoryRequirements, rules.categoryConflicts)) continue
    const availableTraits = getCategoryChoices(category).filter((trait) => isTraitCompatibleWithCombo(trait, combo, rules.incompatibilities))
    if (!availableTraits.length) return []
    combo.push(pickWeightedTrait(availableTraits, random))
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
    let count = 1
    for (const category of categories) {
      count *= getCategoryChoices(category).length
      if (count > limit) return { count: limit, capped: true }
    }
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

function getTraitOffset(trait, axis) {
  const value = Number(axis === 'y' ? trait?.offsetY : trait?.offsetX)
  return Number.isFinite(value) ? Math.round(value) : 0
}

function addNoTraitChance(category, noTraitChance) {
  const currentTotal = category.traits.reduce((total, trait) => total + getTraitWeight(trait), 0)
  const traitBudget = 100 - noTraitChance
  const traits = category.traits.map((trait, index) => {
    const weight = currentTotal > 0 ? (getTraitWeight(trait) / currentTotal) * traitBudget : traitBudget / category.traits.length
    const roundedWeight = Math.round(weight * 10) / 10
    if (index !== category.traits.length - 1) return { ...trait, weight: roundedWeight }
    const previousTotal = category.traits
      .slice(0, -1)
      .reduce((total, previousTrait) => total + Math.round(((getTraitWeight(previousTrait) / currentTotal) * traitBudget) * 10) / 10, 0)
    return { ...trait, weight: Math.max(0.1, Math.round((traitBudget - previousTotal) * 10) / 10) }
  })
  return { ...category, noneWeight: noTraitChance, traits }
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
  return `${formatTraitKey(rule.first, traitOptionMap)} (X ${rule.firstOffsetX}, Y ${rule.firstOffsetY}) with ${formatTraitKey(rule.second, traitOptionMap)} (X ${rule.secondOffsetX}, Y ${rule.secondOffsetY})`
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

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
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

function resizeCanvasForExport(canvas, maxDimension = 0) {
  const limit = Number(maxDimension) || 0
  const longestSide = Math.max(canvas.width, canvas.height)
  if (!limit || longestSide <= limit) return canvas

  const scale = limit / longestSide
  const resized = document.createElement('canvas')
  resized.width = Math.max(1, Math.round(canvas.width * scale))
  resized.height = Math.max(1, Math.round(canvas.height * scale))
  const context = resized.getContext('2d')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(canvas, 0, 0, resized.width, resized.height)
  return resized
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
