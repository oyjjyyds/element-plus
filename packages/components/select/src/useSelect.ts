// @ts-nocheck
import { computed, nextTick, onMounted, reactive, ref, toRaw, watch } from 'vue'
import { isArray, isObject, toRawType } from '@vue/shared'
import {
  findLastIndex,
  get,
  isEqual,
  debounce as lodashDebounce,
} from 'lodash-unified'
import { useResizeObserver } from '@vueuse/core'
import {
  CHANGE_EVENT,
  EVENT_CODE,
  UPDATE_MODEL_EVENT,
} from '@element-plus/constants'
import {
  ValidateComponentsMap,
  debugWarn,
  isClient,
  isFunction,
  isNumber,
  isString,
  isUndefined,
  scrollIntoView,
} from '@element-plus/utils'
import {
  useDeprecated,
  useFocusController,
  useId,
  useLocale,
  useNamespace,
} from '@element-plus/hooks'
import {
  useFormItem,
  useFormItemInputId,
  useFormSize,
} from '@element-plus/components/form'

import { useInput } from '../../select-v2/src/useInput'
import type ElTooltip from '@element-plus/components/tooltip'
import type { ISelectProps, SelectOptionProxy } from './token'

const MINIMUM_INPUT_WIDTH = 11

export const useSelect = (props: ISelectProps, emit) => {
  const { t } = useLocale()
  const contentId = useId()
  const nsSelect = useNamespace('select')
  const nsInput = useNamespace('input')

  const states = reactive({
    inputValue: '',
    options: new Map(),
    cachedOptions: new Map(),
    disabledOptions: new Map(),
    selected: props.multiple ? [] : ({} as any),
    selectionWidth: 0,
    calculatorWidth: 0,
    selectedLabel: '',
    hoveringIndex: -1,
    previousQuery: null,
    inputHovering: false,
    menuVisibleOnFocus: false,
  })

  useDeprecated(
    {
      from: 'suffixTransition',
      replacement: 'override style scheme',
      version: '2.3.0',
      scope: 'props',
      ref: 'https://element-plus.org/en-US/component/select.html#select-attributes',
    },
    computed(() => props.suffixTransition === false)
  )

  // template refs
  const selectRef = ref<HTMLElement>(null)
  const selectionRef = ref<HTMLElement>(null)
  const tooltipRef = ref<InstanceType<typeof ElTooltip> | null>(null)
  const tagTooltipRef = ref<InstanceType<typeof ElTooltip> | null>(null)
  const inputRef = ref<HTMLInputElement | null>(null)
  const calculatorRef = ref<HTMLElement>(null)
  const prefixRef = ref<HTMLElement>(null)
  const suffixRef = ref<HTMLElement>(null)
  const menuRef = ref<HTMLElement>(null)
  const tagMenuRef = ref<HTMLElement>(null)
  const scrollbarRef = ref<{
    handleScroll: () => void
  } | null>(null)

  const { wrapperRef, isFocused, handleFocus, handleBlur } = useFocusController(
    inputRef,
    {
      afterFocus() {
        if (props.automaticDropdown && !expanded.value) {
          expanded.value = true
          states.menuVisibleOnFocus = true
        }
      },
      beforeBlur(event) {
        return (
          tooltipRef.value?.isFocusInsideContent(event) ||
          tagTooltipRef.value?.isFocusInsideContent(event)
        )
      },
      afterBlur() {
        expanded.value = false
        states.menuVisibleOnFocus = false
      },
    }
  )

  // the controller of the expanded popup
  const expanded = ref(false)
  const hoverOption = ref()
  const optionList = ref<string[]>([])

  const { form, formItem } = useFormItem()
  const { inputId } = useFormItemInputId(props, {
    formItemContext: formItem,
  })

  const selectDisabled = computed(() => props.disabled || form?.disabled)

  const hasModelValue = computed(() => {
    return props.multiple
      ? isArray(props.modelValue) && props.modelValue.length > 0
      : props.modelValue !== undefined &&
          props.modelValue !== null &&
          props.modelValue !== ''
  })

  const showClose = computed(() => {
    const criteria =
      props.clearable &&
      !selectDisabled.value &&
      states.inputHovering &&
      hasModelValue.value
    return criteria
  })
  const iconComponent = computed(() =>
    props.remote && props.filterable && !props.remoteShowSuffix
      ? ''
      : props.suffixIcon
  )
  const iconReverse = computed(() =>
    nsSelect.is(
      'reverse',
      iconComponent.value && expanded.value && props.suffixTransition
    )
  )

  const validateState = computed(() => formItem?.validateState || '')
  const validateIcon = computed(
    () => ValidateComponentsMap[validateState.value]
  )

  const debounce = computed(() => (props.remote ? 300 : 0))

  const emptyText = computed(() => {
    if (props.loading) {
      return props.loadingText || t('el.select.loading')
    } else {
      if (props.remote && !states.inputValue && states.options.size === 0)
        return false
      if (
        props.filterable &&
        states.inputValue &&
        states.options.size > 0 &&
        filteredOptionsCount.value === 0
      ) {
        return props.noMatchText || t('el.select.noMatch')
      }
      if (states.options.size === 0) {
        return props.noDataText || t('el.select.noData')
      }
    }
    return null
  })

  const filteredOptionsCount = computed(
    () => optionsArray.value.filter((option) => option.visible).length
  )

  const optionsArray = computed(() => {
    const list = Array.from(states.options.values())
    const newList = []
    optionList.value.forEach((item) => {
      const index = list.findIndex((i) => i.currentLabel === item)
      if (index > -1) {
        newList.push(list[index])
      }
    })
    return newList.length >= list.length ? newList : list
  })

  const cachedOptionsArray = computed(() =>
    Array.from(states.cachedOptions.values())
  )

  const showNewOption = computed(() => {
    const hasExistingOption = optionsArray.value
      .filter((option) => {
        return !option.created
      })
      .some((option) => {
        return option.currentLabel === states.inputValue
      })
    return (
      props.filterable &&
      props.allowCreate &&
      states.inputValue !== '' &&
      !hasExistingOption
    )
  })

  const updateOptions = () => {
    optionsArray.value.forEach((option) => {
      option.updateOption(states.inputValue)
    })
  }

  const selectSize = useFormSize()

  const collapseTagSize = computed(() =>
    ['small'].includes(selectSize.value) ? 'small' : 'default'
  )

  const dropMenuVisible = computed({
    get() {
      return expanded.value && emptyText.value !== false
    },
    set(val: boolean) {
      expanded.value = val
    },
  })

  const shouldShowPlaceholder = computed(() => {
    if (isArray(props.modelValue)) {
      return props.modelValue.length === 0 && !states.inputValue
    }
    return props.filterable ? !states.inputValue : true
  })

  const currentPlaceholder = computed(() => {
    const _placeholder = props.placeholder ?? t('el.select.placeholder')
    return props.multiple || !hasModelValue.value
      ? _placeholder
      : states.selectedLabel
  })

  watch(
    () => props.modelValue,
    (val, oldVal) => {
      if (props.multiple) {
        if (props.filterable && !props.reserveKeyword) {
          states.inputValue = ''
          handleQueryChange('')
        }
      }
      setSelected()
      if (!isEqual(val, oldVal) && props.validateEvent) {
        formItem?.validate('change').catch((err) => debugWarn(err))
      }
    },
    {
      flush: 'post',
      deep: true,
    }
  )

  watch(
    () => expanded.value,
    (val) => {
      if (val) {
        handleQueryChange(states.inputValue)
      } else {
        states.inputValue = ''
        states.previousQuery = null
      }
      emit('visible-change', val)
    }
  )

  watch(
    // fix `Array.prototype.push/splice/..` cannot trigger non-deep watcher
    // https://github.com/vuejs/vue-next/issues/2116
    () => states.options.entries(),
    () => {
      if (!isClient) return
      // tooltipRef.value?.updatePopper?.()
      const inputs = selectRef.value?.querySelectorAll('input') || []
      if (
        (!props.filterable &&
          !props.defaultFirstOption &&
          !isUndefined(props.modelValue)) ||
        !Array.from(inputs).includes(document.activeElement as HTMLInputElement)
      ) {
        setSelected()
      }
      if (
        props.defaultFirstOption &&
        (props.filterable || props.remote) &&
        filteredOptionsCount.value
      ) {
        checkDefaultFirstOption()
      }
    },
    {
      flush: 'post',
    }
  )

  watch(
    () => states.hoveringIndex,
    (val) => {
      if (isNumber(val) && val > -1) {
        hoverOption.value = optionsArray.value[val] || {}
      } else {
        hoverOption.value = {}
      }
      optionsArray.value.forEach((option) => {
        option.hover = hoverOption.value === option
      })
    }
  )

  const handleQueryChange = (val: string) => {
    if (states.previousQuery === val) {
      return
    }
    states.previousQuery = val
    if (props.filterable && isFunction(props.filterMethod)) {
      props.filterMethod(val)
    } else if (
      props.filterable &&
      props.remote &&
      isFunction(props.remoteMethod)
    ) {
      props.remoteMethod(val)
    } else {
      updateOptions()
    }
    if (
      props.defaultFirstOption &&
      (props.filterable || props.remote) &&
      filteredOptionsCount.value
    ) {
      nextTick(checkDefaultFirstOption)
    } else {
      nextTick(updateHoveringIndex)
    }
  }

  /**
   * find and highlight first option as default selected
   * @remark
   * - if the first option in dropdown list is user-created,
   *   it would be at the end of the optionsArray
   *   so find it and set hover.
   *   (NOTE: there must be only one user-created option in dropdown list with query)
   * - if there's no user-created option in list, just find the first one as usual
   *   (NOTE: exclude options that are disabled or in disabled-group)
   */
  const checkDefaultFirstOption = () => {
    const optionsInDropdown = optionsArray.value.filter(
      (n) => n.visible && !n.disabled && !n.states.groupDisabled
    )
    const userCreatedOption = optionsInDropdown.find((n) => n.created)
    const firstOriginOption = optionsInDropdown[0]
    states.hoveringIndex = getValueIndex(
      optionsArray.value,
      userCreatedOption || firstOriginOption
    )
  }

  const setSelected = () => {
    if (!props.multiple) {
      const option = getOption(props.modelValue)
      states.selectedLabel = option.currentLabel
      states.selected = option
      return
    } else {
      states.selectedLabel = ''
    }
    const result: any[] = []
    if (isArray(props.modelValue)) {
      props.modelValue.forEach((value) => {
        result.push(getOption(value))
      })
    }
    states.selected = result
  }

  const getOption = (value) => {
    let option
    const isObjectValue = toRawType(value).toLowerCase() === 'object'
    const isNull = toRawType(value).toLowerCase() === 'null'
    const isUndefined = toRawType(value).toLowerCase() === 'undefined'

    for (let i = states.cachedOptions.size - 1; i >= 0; i--) {
      const cachedOption = cachedOptionsArray.value[i]
      const isEqualValue = isObjectValue
        ? get(cachedOption.value, props.valueKey) === get(value, props.valueKey)
        : cachedOption.value === value
      if (isEqualValue) {
        option = {
          value,
          currentLabel: cachedOption.currentLabel,
          isDisabled: cachedOption.isDisabled,
        }
        break
      }
    }
    if (option) return option
    const label = isObjectValue
      ? value.label
      : !isNull && !isUndefined
      ? value
      : ''
    const newOption = {
      value,
      currentLabel: label,
    }
    return newOption
  }

  const updateHoveringIndex = () => {
    const valueKey = props.valueKey
    if (!props.multiple) {
      states.hoveringIndex = optionsArray.value.findIndex((item) => {
        return getValueKey(item) === getValueKey(states.selected)
      })
    } else {
      if (states.selected.length > 0) {
        states.hoveringIndex = Math.min(
          ...states.selected.map((selected) => {
            return optionsArray.value.findIndex((item) => {
              return get(item, valueKey) === get(selected, valueKey)
            })
          })
        )
      } else {
        states.hoveringIndex = -1
      }
    }
  }

  const resetSelectionWidth = () => {
    states.selectionWidth = selectionRef.value.getBoundingClientRect().width
  }

  const resetCalculatorWidth = () => {
    states.calculatorWidth = calculatorRef.value.getBoundingClientRect().width
  }

  const updateTooltip = () => {
    tooltipRef.value?.updatePopper?.()
  }

  const updateTagTooltip = () => {
    tagTooltipRef.value?.updatePopper?.()
  }

  const onInputChange = () => {
    handleQueryChange(states.inputValue)
  }

  const onInput = (event) => {
    states.inputValue = event.target.value
    if (states.inputValue.length > 0 && !expanded.value) {
      expanded.value = true
    }
    if (props.remote) {
      debouncedOnInputChange()
    } else {
      return onInputChange()
    }
  }

  const debouncedOnInputChange = lodashDebounce(() => {
    onInputChange()
  }, debounce.value)

  const emitChange = (val) => {
    if (!isEqual(props.modelValue, val)) {
      emit(CHANGE_EVENT, val)
    }
  }

  const getLastNotDisabledIndex = (value) =>
    findLastIndex(value, (it) => !states.disabledOptions.has(it))

  const deletePrevTag = (e) => {
    if (!props.multiple) return
    if (e.code === EVENT_CODE.delete) return
    if (e.target.value.length <= 0) {
      const value = props.modelValue.slice()
      const lastNotDisabledIndex = getLastNotDisabledIndex(value)
      if (lastNotDisabledIndex < 0) return
      value.splice(lastNotDisabledIndex, 1)
      emit(UPDATE_MODEL_EVENT, value)
      emitChange(value)
    }
  }

  const deleteTag = (event, tag) => {
    const index = states.selected.indexOf(tag)
    if (index > -1 && !selectDisabled.value) {
      const value = props.modelValue.slice()
      value.splice(index, 1)
      emit(UPDATE_MODEL_EVENT, value)
      emitChange(value)
      emit('remove-tag', tag.value)
    }
    event.stopPropagation()
    focus()
  }

  const deleteSelected = (event) => {
    event.stopPropagation()
    const value: string | any[] = props.multiple ? [] : ''
    if (!isString(value)) {
      for (const item of states.selected) {
        if (item.isDisabled) value.push(item.value)
      }
    }
    emit(UPDATE_MODEL_EVENT, value)
    emitChange(value)
    states.hoveringIndex = -1
    expanded.value = false
    emit('clear')
    focus()
  }

  const handleOptionSelect = (option) => {
    if (props.multiple) {
      const value = (props.modelValue || []).slice()
      const optionIndex = getValueIndex(value, option.value)
      if (optionIndex > -1) {
        value.splice(optionIndex, 1)
      } else if (
        props.multipleLimit <= 0 ||
        value.length < props.multipleLimit
      ) {
        value.push(option.value)
      }
      emit(UPDATE_MODEL_EVENT, value)
      emitChange(value)
      if (option.created) {
        handleQueryChange('')
      }
      if (props.filterable && !props.reserveKeyword) {
        states.inputValue = ''
      }
    } else {
      emit(UPDATE_MODEL_EVENT, option.value)
      emitChange(option.value)
      expanded.value = false
    }
    focus()
    if (expanded.value) return
    nextTick(() => {
      scrollToOption(option)
    })
  }

  const getValueIndex = (arr: any[] = [], value) => {
    if (!isObject(value)) return arr.indexOf(value)

    const valueKey = props.valueKey
    let index = -1
    arr.some((item, i) => {
      if (toRaw(get(item, valueKey)) === get(value, valueKey)) {
        index = i
        return true
      }
      return false
    })
    return index
  }

  const scrollToOption = (option) => {
    const targetOption = isArray(option) ? option[0] : option
    let target = null

    if (targetOption?.value) {
      const options = optionsArray.value.filter(
        (item) => item.value === targetOption.value
      )
      if (options.length > 0) {
        target = options[0].$el
      }
    }

    if (tooltipRef.value && target) {
      const menu = tooltipRef.value?.popperRef?.contentRef?.querySelector?.(
        `.${nsSelect.be('dropdown', 'wrap')}`
      )
      if (menu) {
        scrollIntoView(menu as HTMLElement, target)
      }
    }
    scrollbarRef.value?.handleScroll()
  }

  const onOptionCreate = (vm: SelectOptionProxy) => {
    states.options.set(vm.value, vm)
    states.cachedOptions.set(vm.value, vm)
    vm.disabled && states.disabledOptions.set(vm.value, vm)
  }

  const onOptionDestroy = (key, vm: SelectOptionProxy) => {
    if (states.options.get(key) === vm) {
      states.options.delete(key)
    }
  }

  const {
    handleCompositionStart,
    handleCompositionUpdate,
    handleCompositionEnd,
  } = useInput((e) => onInput(e))

  const popperRef = computed(() => {
    return tooltipRef.value?.popperRef?.contentRef
  })

  const onOptionsRendered = (v) => {
    optionList.value = v
  }

  const handleMenuEnter = () => {
    nextTick(() => scrollToOption(states.selected))
  }

  const focus = () => {
    inputRef.value?.focus()
  }

  const blur = () => {
    inputRef.value?.blur()
  }

  const handleClearClick = (event: Event) => {
    deleteSelected(event)
  }

  const handleClickOutside = (event: Event) => {
    expanded.value = false

    if (isFocused.value) {
      const _event = new FocusEvent('focus', event)
      handleBlur(_event)
    }
  }

  const handleEsc = () => {
    if (states.inputValue.length > 0) {
      states.inputValue = ''
    } else {
      expanded.value = false
    }
  }

  const toggleMenu = () => {
    if (selectDisabled.value) return
    if (states.menuVisibleOnFocus) {
      // controlled by automaticDropdown
      states.menuVisibleOnFocus = false
    } else {
      expanded.value = !expanded.value
    }
  }

  const selectOption = () => {
    if (!expanded.value) {
      toggleMenu()
    } else {
      if (optionsArray.value[states.hoveringIndex]) {
        handleOptionSelect(optionsArray.value[states.hoveringIndex])
      }
    }
  }

  const getValueKey = (item) => {
    return isObject(item.value) ? get(item.value, props.valueKey) : item.value
  }

  const optionsAllDisabled = computed(() =>
    optionsArray.value
      .filter((option) => option.visible)
      .every((option) => option.disabled)
  )

  const showTagList = computed(() => {
    if (!props.multiple) {
      return []
    }
    return props.collapseTags
      ? states.selected.slice(0, props.maxCollapseTags)
      : states.selected
  })

  const collapseTagList = computed(() => {
    if (!props.multiple) {
      return []
    }
    return props.collapseTags
      ? states.selected.slice(props.maxCollapseTags)
      : []
  })

  const navigateOptions = (direction) => {
    if (!expanded.value) {
      expanded.value = true
      return
    }
    if (states.options.size === 0 || filteredOptionsCount.value === 0) return

    if (!optionsAllDisabled.value) {
      if (direction === 'next') {
        states.hoveringIndex++
        if (states.hoveringIndex === states.options.size) {
          states.hoveringIndex = 0
        }
      } else if (direction === 'prev') {
        states.hoveringIndex--
        if (states.hoveringIndex < 0) {
          states.hoveringIndex = states.options.size - 1
        }
      }
      const option = optionsArray.value[states.hoveringIndex]
      if (
        option.disabled === true ||
        option.states.groupDisabled === true ||
        !option.visible
      ) {
        navigateOptions(direction)
      }
      nextTick(() => scrollToOption(hoverOption.value))
    }
  }

  // computed style
  const tagStyle = computed(() => {
    return { maxWidth: `${states.selectionWidth}px` }
  })

  const inputStyle = computed(() => ({
    width: `${Math.max(states.calculatorWidth, MINIMUM_INPUT_WIDTH)}px`,
  }))

  if (props.multiple && !isArray(props.modelValue)) {
    emit(UPDATE_MODEL_EVENT, [])
  }
  if (!props.multiple && isArray(props.modelValue)) {
    emit(UPDATE_MODEL_EVENT, '')
  }

  useResizeObserver(selectionRef, resetSelectionWidth)
  useResizeObserver(calculatorRef, resetCalculatorWidth)
  useResizeObserver(menuRef, updateTooltip)
  useResizeObserver(tagMenuRef, updateTagTooltip)

  onMounted(() => {
    setSelected()
  })

  return {
    inputId,
    contentId,
    nsSelect,
    nsInput,
    states,
    isFocused,
    expanded,
    optionList,
    optionsArray,
    hoverOption,
    selectSize,
    filteredOptionsCount,
    resetCalculatorWidth,
    updateTooltip,
    updateTagTooltip,
    debouncedOnInputChange,
    onInput,
    deletePrevTag,
    deleteTag,
    deleteSelected,
    handleOptionSelect,
    scrollToOption,
    hasModelValue,
    shouldShowPlaceholder,
    currentPlaceholder,
    showClose,
    iconComponent,
    iconReverse,
    validateState,
    validateIcon,
    showNewOption,
    updateOptions,
    collapseTagSize,
    setSelected,
    selectDisabled,
    emptyText,
    handleCompositionStart,
    handleCompositionUpdate,
    handleCompositionEnd,
    onOptionsRendered,
    onOptionCreate,
    onOptionDestroy,
    handleMenuEnter,
    handleFocus,
    focus,
    blur,
    handleBlur,
    handleClearClick,
    handleClickOutside,
    handleEsc,
    toggleMenu,
    selectOption,
    getValueKey,
    navigateOptions,
    dropMenuVisible,
    showTagList,
    collapseTagList,

    // computed style
    tagStyle,
    inputStyle,

    // DOM ref
    popperRef,
    inputRef,
    tooltipRef,
    tagTooltipRef,
    calculatorRef,
    prefixRef,
    suffixRef,
    selectRef,
    wrapperRef,
    selectionRef,
    scrollbarRef,
    menuRef,
    tagMenuRef,
  }
}
