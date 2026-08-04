import { useEffect, useMemo, useRef, useState } from 'react'
import { readPsd } from 'ag-psd'
import JSZip from 'jszip'
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
  Layers3,
  Loader2,
  Play,
  RotateCcw,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import './App.css'
import { findCombinationViolation, findInvalidCombination } from './ruleValidation.js'
import { buildSmartRarityProfile } from './smartRarities.js'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const LARGE_PSD_WARNING_SIZE = 100 * 1024 * 1024
const COMBO_COUNT_DISPLAY_LIMIT = 1000000
const METADATA_FILE_NAME = 'metadata-file.csv'
const PREVIEW_DEBOUNCE_MS = 250
const PREVIEW_MAX_DIMENSION = 1024
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
const emptyConditionDraft = { category: '', requiredTrait: '' }
const emptyFolderConflictDraft = { first: '', second: '' }

function App() {
  const [project, setProject] = useState(DEFAULT_PROJECT)
  const [source, setSource] = useState(null)
  const [status, setStatus] = useState('Drop in a PSD or trait folders to begin.')
  const [busy, setBusy] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [lastZipUrl, setLastZipUrl] = useState('')
  const [lastZipName, setLastZipName] = useState('')
  const [selectedCategoryIndex, setSelectedCategoryIndex] = useState(0)
  const [traitEditorOpen, setTraitEditorOpen] = useState(false)
  const [ruleDraft, setRuleDraft] = useState(emptyRuleDraft)
  const [conditionDraft, setConditionDraft] = useState(emptyConditionDraft)
  const [folderConflictDraft, setFolderConflictDraft] = useState(emptyFolderConflictDraft)
  const psdInputRef = useRef(null)
  const baseInputRef = useRef(null)
  const folderInputRef = useRef(null)
  const baseFileRef = useRef(null)
  const previewTimerRef = useRef(null)
  const previewRequestRef = useRef(0)
  const maxEditionsCacheRef = useRef({ key: null, value: { count: 0, capped: false } })

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

  useEffect(
    () => () => {
      if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current)
      previewRequestRef.current += 1
    },
    [],
  )

  async function handlePsdUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return

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
        skipCompositeImageData: true,
        skipThumbnail: true,
      })
      const parsed = parsePsd(psd, file.name)
      setSource(parsed)
      setSelectedCategoryIndex(0)
      setStatus(`Loaded ${parsed.categories.length} categories from ${file.name}.`)
      await renderPreview(parsed)
    } catch (error) {
      setStatus(getErrorMessage(error, 'Could not read that PSD. Try a layered RGB PSD with rasterized trait layers.'))
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  async function handleBaseUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return

    baseFileRef.current = file
    setStatus(`Base image selected: ${file.name}. Now add the trait folder.`)
    event.target.value = ''
  }

  async function handleFolderUpload(event) {
    const files = Array.from(event.target.files || [])
    if (!files.length) return

    setBusy(true)
    setStatus('Reading folder traits...')
    try {
      const parsed = await parseFolders(files, baseFileRef.current)
      setSource(parsed)
      setSelectedCategoryIndex(0)
      setStatus(`Loaded ${parsed.categories.length} categories from folder upload.`)
      await renderPreview(parsed)
    } catch (error) {
      setStatus(getErrorMessage(error, 'Could not read those folders. Use image files inside category folders.'))
    } finally {
      setBusy(false)
      event.target.value = ''
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

  function schedulePreview(activeSource) {
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current)
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null
      renderPreview(activeSource).catch((error) => {
        setStatus(getErrorMessage(error, 'Could not refresh the preview.'))
      })
    }, PREVIEW_DEBOUNCE_MS)
  }

  async function previewTrait(categoryIndex, traitIndex) {
    if (!source || busy) return
    const category = source.categories[categoryIndex]
    const trait = category?.traits[traitIndex]
    if (!trait) return

    const blob = await renderArtwork(source, [trait])
    const url = URL.createObjectURL(blob)
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return url
    })
    setStatus(`Previewing ${category.name} / ${getTraitMetadataName(trait)}.`)
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
    setStatus(`Render order updated: ${categories.map((item) => item.name).join(' -> ')}.`)
    await renderPreview(nextSource)
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
    const capacity = validCombinationInfo.capped ? `${validCombinationInfo.count.toLocaleString()}+` : validCombinationInfo.count.toLocaleString()
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

  async function generateCollection() {
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
    if (!validCombinationInfo.count) {
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

  function chooseProjectBackup() {
    if (!source || busy) return
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

  const traitOptions = source?.categories?.flatMap((category) =>
    category.traits.map((trait) => ({
      key: makeTraitKey(trait),
      label: `${category.name} / ${trait.name}`,
    })),
  ) || []
  const traitOptionMap = new Map(traitOptions.map((trait) => [trait.key, trait.label]))

  const incompatibilities = source?.incompatibilities || []
  const categoryRequirements = source?.categoryRequirements || []
  const categoryConflicts = source?.categoryConflicts || []
  const traitEditorCategory = selectedCategory || source?.categories?.[0] || null
  const traitEditorCategoryIndex = source?.categories?.length ? Math.min(selectedCategoryIndex, source.categories.length - 1) : 0
  const totalTraitCount = source?.categories?.reduce((total, category) => total + category.traits.length, 0) || 0

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">NFT trait combiner</p>
          <h1>Trait Forge</h1>
        </div>
        <div className="status-pill">
          {busy ? <Loader2 className="spin" size={17} /> : <CheckCircle2 size={17} />}
          <span>{status}</span>
        </div>
      </section>

      <section className="workbench">
        <aside className="panel upload-panel">
          <h2>Sources</h2>
          <button className="drop-button" type="button" onClick={() => psdInputRef.current?.click()} disabled={busy}>
            <Layers3 size={22} />
            <span>
              <strong>Single PSD</strong>
              <small>Root folders become trait categories.</small>
            </span>
          </button>
          <div className="split-row">
            <button type="button" onClick={() => baseInputRef.current?.click()} disabled={busy}>
              <ImagePlus size={18} />
              Base image
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

          <div className="trait-list">
            <div className="list-header">
              <span>Render order</span>
              <span>{formatComboCount(maxEditionsInfo)}</span>
            </div>
            {sourceSummary.length ? (
              sourceSummary.map((item, index) => (
                <div className={`trait-row ${item.enabled ? '' : 'disabled'} ${selectedCategoryIndex === index ? 'selected' : ''}`} key={`${item.name}-${index}`}>
                  <button className="trait-select" type="button" onClick={() => setSelectedCategoryIndex(index)}>
                    <span>{item.name}</span>
                    {!item.enabled && <small>Excluded</small>}
                  </button>
                  <div className="trait-actions">
                    <strong>{item.enabled ? item.count : 0}/{item.total}</strong>
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
              <button className="rarity-action" type="button" disabled={busy} onClick={randomizeTraitRarities}>
                <Shuffle size={16} />
                Randomize rarities
              </button>
              <p className="chance-note">Analyzes the collection size and folder purpose, then assigns balanced percentages and smart No trait chances.</p>
            </div>
          )}

          {source && (
            <div className="rule-panel">
              <div className="chance-header">
                <span>
                  <Ban size={15} />
                  Trait manager
                </span>
                <strong>{incompatibilities.length}</strong>
              </div>
              <label>
                First trait
                <select value={ruleDraft.first} disabled={busy} onChange={(event) => setRuleDraft((current) => ({ ...current, first: event.target.value }))}>
                  <option value="">Choose trait</option>
                  {traitOptions.map((trait) => (
                    <option value={trait.key} key={trait.key}>
                      {trait.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cannot appear with
                <select value={ruleDraft.second} disabled={busy} onChange={(event) => setRuleDraft((current) => ({ ...current, second: event.target.value }))}>
                  <option value="">Choose trait</option>
                  {traitOptions.map((trait) => (
                    <option value={trait.key} key={trait.key}>
                      {trait.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="rule-add" type="button" disabled={busy || !ruleDraft.first || !ruleDraft.second || ruleDraft.first === ruleDraft.second} onClick={addIncompatibility}>
                <Ban size={16} />
                Add rule
              </button>
              {incompatibilities.length ? (
                <div className="rule-list">
                  {incompatibilities.map((rule, index) => (
                    <div className="rule-row" key={makeRuleKey(rule)}>
                      <span>{formatRule(rule, traitOptionMap)}</span>
                      <button type="button" disabled={busy} aria-label={`Remove rule ${formatRule(rule, traitOptionMap)}`} onClick={() => removeIncompatibility(index)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="chance-note">Add rules for traits that should never be used in the same image.</p>
              )}

              <div className="rule-divider" />
              <div className="chance-header">
                <span>Folder rules</span>
                <strong>{categoryRequirements.length}</strong>
              </div>
              <label>
                Folder
                <select value={conditionDraft.category} disabled={busy} onChange={(event) => setConditionDraft((current) => ({ ...current, category: event.target.value }))}>
                  <option value="">Choose folder</option>
                  {source.categories.map((category) => (
                    <option value={category.name} key={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Only apply when
                <select value={conditionDraft.requiredTrait} disabled={busy} onChange={(event) => setConditionDraft((current) => ({ ...current, requiredTrait: event.target.value }))}>
                  <option value="">Choose trait</option>
                  {traitOptions.map((trait) => (
                    <option value={trait.key} key={trait.key}>
                      {trait.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="rule-add" type="button" disabled={busy || !conditionDraft.category || !conditionDraft.requiredTrait} onClick={addCategoryRequirement}>
                <Ban size={16} />
                Add folder rule
              </button>
              {categoryRequirements.length ? (
                <div className="rule-list">
                  {categoryRequirements.map((rule, index) => (
                    <div className="rule-row" key={`${rule.category}-${rule.requiredTrait}`}>
                      <span>{formatCategoryRequirement(rule, traitOptionMap)}</span>
                      <button type="button" disabled={busy} aria-label={`Remove rule ${formatCategoryRequirement(rule, traitOptionMap)}`} onClick={() => removeCategoryRequirement(index)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="chance-note">Use this for a whole folder, like Bobo Teeth only applying with Face / Bobo.</p>
              )}

              <div className="rule-divider" />
              <div className="chance-header">
                <span>Folder conflicts</span>
                <strong>{categoryConflicts.length}</strong>
              </div>
              <label>
                First folder
                <select value={folderConflictDraft.first} disabled={busy} onChange={(event) => setFolderConflictDraft((current) => ({ ...current, first: event.target.value }))}>
                  <option value="">Choose folder</option>
                  {source.categories.map((category) => (
                    <option value={category.name} key={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cannot appear with
                <select value={folderConflictDraft.second} disabled={busy} onChange={(event) => setFolderConflictDraft((current) => ({ ...current, second: event.target.value }))}>
                  <option value="">Choose folder</option>
                  {source.categories.map((category) => (
                    <option value={category.name} key={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="rule-add"
                type="button"
                disabled={busy || !folderConflictDraft.first || !folderConflictDraft.second || folderConflictDraft.first === folderConflictDraft.second}
                onClick={addCategoryConflict}
              >
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
              ) : (
                <p className="chance-note">Use this when two whole folders should never render in the same image.</p>
              )}
            </div>
          )}
        </aside>

        <section className="preview-stage">
          {previewUrl ? (
            <img src={previewUrl} alt="Generated artwork preview" />
          ) : (
            <div className="preview-empty">
              <Upload size={36} />
              <span>Preview appears after traits load.</span>
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
                {maxEditions ? `${editionFormula} = ${formatComboCount(maxEditionsInfo)} maximum` : 'Load traits to calculate the maximum.'}
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

          <button className="primary-action" type="button" onClick={generateCollection} disabled={busy || !source}>
            {busy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
            Generate ZIP
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

      {traitEditorOpen && source?.categories?.length && (
        <div className="modal-backdrop" role="presentation">
          <section className="trait-editor-modal" role="dialog" aria-modal="true" aria-label="Trait editor">
            <header className="modal-header">
              <div>
                <p className="eyebrow">Trait metadata</p>
                <h2>Trait editor</h2>
              </div>
              <button type="button" aria-label="Close trait editor" onClick={() => setTraitEditorOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <div className="trait-editor-workspace">
              <nav className="trait-editor-nav" aria-label="Trait folders">
                {source.categories.map((category, categoryIndex) => (
                  <button
                    className={traitEditorCategoryIndex === categoryIndex ? 'active' : ''}
                    type="button"
                    key={`${category.name}-${categoryIndex}`}
                    onClick={() => setSelectedCategoryIndex(categoryIndex)}
                  >
                    <span>{category.name}</span>
                    <strong>{getWeightedTraits(category).length}/{category.traits.length}</strong>
                  </button>
                ))}
              </nav>
              <aside className="trait-editor-preview" aria-label="Current preview">
                <div className="trait-editor-preview-frame">
                  {previewUrl ? (
                    <img src={previewUrl} alt="Current artwork preview" />
                  ) : (
                    <div className="trait-editor-preview-empty">
                      <Upload size={24} />
                    </div>
                  )}
                </div>
                <span>Current preview</span>
              </aside>
              {traitEditorCategory && (
                <div className="trait-editor-detail">
                  <div className="trait-editor-detail-header">
                    <label className="group-name-control">
                      Group name
                      <input
                        value={traitEditorCategory.name}
                        disabled={busy || traitEditorCategory.enabled === false}
                        onChange={(event) => renameCategory(traitEditorCategoryIndex, event.target.value)}
                      />
                      <span>{traitEditorCategory.traits.length} traits</span>
                    </label>
                    <label className="none-control">
                      No trait (%)
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={traitEditorCategory.noneWeight ?? 0}
                        disabled={busy || traitEditorCategory.enabled === false}
                        onChange={(event) => updateCategoryNoneWeight(traitEditorCategoryIndex, event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="trait-editor-table">
                    <div className="trait-editor-table-head">
                      <span>Name in metadata</span>
                      <span>Chance (%)</span>
                      <span>Preview</span>
                    </div>
                    {traitEditorCategory.traits.map((trait, traitIndex) => (
                      <div className="trait-editor-table-row" key={`${getTraitId(trait)}-${traitIndex}`}>
                        <input
                          aria-label={`Rename ${trait.originalName || trait.name}`}
                          value={trait.name}
                          disabled={busy || traitEditorCategory.enabled === false}
                          onChange={(event) => renameTrait(traitEditorCategoryIndex, traitIndex, event.target.value)}
                        />
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={trait.weight ?? 1}
                          disabled={busy || traitEditorCategory.enabled === false}
                          onChange={(event) => updateTraitWeight(traitEditorCategoryIndex, traitIndex, event.target.value)}
                        />
                        <button type="button" disabled={busy} aria-label={`Preview ${trait.name}`} title="Preview trait" onClick={() => previewTrait(traitEditorCategoryIndex, traitIndex)}>
                          <Eye size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
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
        })),
      })),
      incompatibilities: (source.incompatibilities || []).map((rule) => ({
        first: rule.first,
        second: rule.second,
        firstMatches: matchesForId(rule.first),
        secondMatches: matchesForId(rule.second),
      })),
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
  const restoredSource = {
    ...source,
    categories: restoredCategories,
    incompatibilities,
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
    ruleCount: incompatibilities.length,
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
    categoryRequirements: [],
    categoryConflicts: [],
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

  if (source.type === 'psd') {
    for (const layer of [...source.baseLayers].reverse()) {
      drawPsdLayer(context, layer)
    }
    for (const trait of traits) {
      if (trait.isNone) continue
      for (const layer of trait.layers) {
        drawPsdLayer(context, layer)
      }
    }
  } else {
    if (source.baseImage) context.drawImage(source.baseImage, 0, 0, source.width, source.height)
    for (const trait of traits) {
      if (trait.isNone) continue
      context.drawImage(trait.image, 0, 0, source.width, source.height)
    }
  }

  const exportCanvas = resizeCanvasForExport(canvas, options.maxDimension)
  return canvasToBlob(exportCanvas, options.mime || 'image/png', options.quality)
}

function drawPsdLayer(context, layer) {
  if (!hasRenderableCanvas(layer)) return
  const opacity = typeof layer.opacity === 'number' ? layer.opacity : 1
  context.save()
  context.globalAlpha = opacity
  context.drawImage(layer.canvas, layer.left || 0, layer.top || 0)
  context.restore()
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

function countValidCombinations(categories, rules = {}, limit = Number.POSITIVE_INFINITY) {
  if (!rules.incompatibilities?.length && !rules.categoryRequirements?.length && !rules.categoryConflicts?.length) {
    let count = 1
    for (const category of categories) {
      count *= getCategoryChoices(category).length
      if (count > limit) return { count: limit, capped: true }
    }
    return { count, capped: false }
  }

  function countFrom(categoryIndex, combo) {
    if (categoryIndex >= categories.length) return findCombinationViolation(combo, rules) ? 0 : 1
    const category = categories[categoryIndex]
    if (!shouldApplyCategory(category, combo, rules.categoryRequirements, rules.categoryConflicts)) {
      return countFrom(categoryIndex + 1, combo)
    }

    let count = 0
    for (const trait of getCategoryChoices(category)) {
      if (isTraitCompatibleWithCombo(trait, combo, rules.incompatibilities)) {
        count += countFrom(categoryIndex + 1, [...combo, trait])
        if (count > limit) return count
      }
    }
    return count
  }

  const count = countFrom(0, [])
  return { count: Math.min(count, limit), capped: count > limit }
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

function formatTraitKey(key, traitOptionMap = new Map()) {
  return traitOptionMap.get(key) || key.replace('::', ' / ')
}

function formatComboCount(info) {
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
  return Boolean(layer?.canvas && layer.canvas.width && layer.canvas.height)
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
