import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildTaskTableHtml, buildTaskTableText, copyTaskTableToClipboard } from '../taskCopy'
import { DEFAULT_TASK_COLOR_CONFIG, TASK_TEXT_COLOR, TASK_URGENT_TEXT_COLOR } from '../taskColors'
import type { TaskItem } from '../../pages/Dashboard/types'

/**
 * 复制成表格 = 用户每天在用的功能，出错的表现是「粘出来的东西不对」，
 * 而且富文本这条链路没法靠肉眼回归（剪贴板内容看不见），只能靠单测锁。
 * 这里覆盖：文本行序、请假/出差文案、HTML 转义、三种配色状态、宽度换算、四条剪贴板兜底路径。
 */

const config = DEFAULT_TASK_COLOR_CONFIG

const task = (overrides: Partial<TaskItem> = {}): TaskItem => ({
  id: 't1',
  taskName: '确认图 A',
  hours: 1.5,
  ...overrides,
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (navigator as any).clipboard
})

describe('buildTaskTableText', () => {
  it('每条主任务一行，其下每个枪名一行', () => {
    const text = buildTaskTableText({
      items: [
        task({
          taskName: '确认图 A',
          guns: [
            { id: 'g1', name: 'SRTC-01', hours: 1 },
            { id: 'g2', name: 'SRTC-02', hours: 1 },
          ],
        }),
        task({ id: 't2', taskName: '设计 B', guns: [{ id: 'g3', name: 'SRTX-01', hours: 3 }] }),
      ],
      config,
    })
    expect(text.split('\n')).toEqual(['确认图 A', 'SRTC-01', 'SRTC-02', '设计 B', 'SRTX-01'])
  })

  it('空任务名显示「无」、空枪名显示「未命名」', () => {
    const text = buildTaskTableText({
      items: [task({ taskName: '', guns: [{ id: 'g1', name: '', hours: 1 }] })],
      config,
    })
    expect(text.split('\n')).toEqual(['无', '未命名'])
  })

  it('没有枪名的主任务只占一行', () => {
    expect(buildTaskTableText({ items: [task({ taskName: '设计', guns: [] })], config })).toBe('设计')
  })

  it('请假行显示状态文字，不显示任务名', () => {
    const text = buildTaskTableText({
      items: [
        task({ taskName: '明明有名字', leaveType: 'sick' }),
        task({ id: 't2', taskName: 'x', leaveType: 'vacation' }),
        task({ id: 't3', taskName: 'y', leaveType: 'illness' }),
      ],
      config,
    })
    expect(text.split('\n')).toEqual(['事假', '休假', '病假'])
  })

  it('出差行按「地名 + 出差」显示，已带后缀的不重复拼', () => {
    const text = buildTaskTableText({
      items: [
        task({ taskName: '', leaveType: 'trip' }),
        task({ id: 't2', taskName: '上海', leaveType: 'trip' }),
        task({ id: 't3', taskName: '上海出差', leaveType: 'trip' }),
      ],
      config,
    })
    expect(text.split('\n')).toEqual(['出差', '上海出差', '上海出差'])
  })
})

describe('buildTaskTableHtml', () => {
  it('每条行模型对应一个 <tr>，并且是 table 结构', () => {
    const html = buildTaskTableHtml({
      items: [task({ guns: [{ id: 'g1', name: 'SRTC-01', hours: 1 }, { id: 'g2', name: 'SRTC-02', hours: 1 }] })],
      config,
    })
    expect(html.startsWith('<table')).toBe(true)
    expect(html.endsWith('</table>')).toBe(true)
    expect(html.match(/<tr>/g)).toHaveLength(3) // 1 条主任务 + 2 个枪名
    // 粘贴目标会丢掉 <style>，所以样式必须内联
    expect(html).not.toContain('<style')
    expect(html).toContain('border-collapse:collapse')
  })

  it('把 & < > " \' 转义，防止任务名里的尖括号破坏表格结构', () => {
    const html = buildTaskTableHtml({
      items: [task({ taskName: `<b>&"'危险</b>`, guns: [] })],
      config,
    })
    expect(html).toContain('&lt;b&gt;&amp;&quot;&#39;危险&lt;/b&gt;')
    expect(html).not.toContain('<b>')
  })

  it('普通任务用任务内容配色 + 黑色文字', () => {
    const html = buildTaskTableHtml({ items: [task({ taskName: '确认图' })], config })
    expect(html).toContain(`background-color:${config.confirm}`)
    expect(html).toContain(`color:${TASK_TEXT_COLOR}`)
    // 无枪名时主任务行居中，有枪名时左对齐
    expect(html).toContain('text-align:center')
  })

  it('加急任务换成加急底色，文字变红', () => {
    const html = buildTaskTableHtml({ items: [task({ taskName: '设计', urgent: true })], config })
    expect(html).toContain(`background-color:${config.urgentDesign}`)
    expect(html).toContain(`color:${TASK_URGENT_TEXT_COLOR}`)
  })

  it('暂停/取消任务整行纯红底黑字，且忽略加急', () => {
    const html = buildTaskTableHtml({
      items: [task({ taskName: '确认图 暂停/取消', urgent: true })],
      config,
    })
    expect(html).toContain(`background-color:${config.paused}`)
    expect(html).toContain(`color:${TASK_TEXT_COLOR}`)
    expect(html).not.toContain(TASK_URGENT_TEXT_COLOR)
  })

  it('已完成的枪名行保留白底，主任务行不跟着变白', () => {
    const html = buildTaskTableHtml({
      items: [task({
        taskName: '设计',
        guns: [
          { id: 'g1', name: '已完成枪', hours: 3, color: '#ffffff' },
          { id: 'g2', name: '未完成枪', hours: 3 },
        ],
      })],
      config,
    })
    const cells = html.match(/<td[^>]*>[^<]*<\/td>/g) || []
    expect(cells).toHaveLength(3)
    expect(cells[0]).toContain(`background-color:${config.design}`)
    expect(cells[1]).toContain('background-color:#ffffff')
    expect(cells[2]).toContain(`background-color:${config.design}`)
  })

  it('宽度按实测值等比放大 4/3，过小的实测值回落到默认 251px 再放大', () => {
    const scaledOf = (v: number) => Math.round(v * (4 / 3) * 100) / 100

    const withDefault = buildTaskTableHtml({ items: [task()], config })
    expect(withDefault).toContain(`width:${scaledOf(251)}px`)

    const tooSmall = buildTaskTableHtml({ items: [task()], config, nameContentWidth: 10 })
    expect(tooSmall).toContain(`width:${scaledOf(251)}px`)

    const measured = buildTaskTableHtml({ items: [task()], config, nameContentWidth: 300 })
    expect(measured).toContain(`width:${scaledOf(300)}px`)
    // content-box 必须显式声明，否则粘贴目标的 border-box 会把断行点整体前移
    expect(measured).toContain('box-sizing:content-box')
  })
})

describe('copyTaskTableToClipboard 的兜底顺序', () => {
  const options = { items: [task({ taskName: '确认图' })], config }

  it('① 异步剪贴板可用时写入 text/html + text/plain，返回 rich', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true })
    vi.stubGlobal('ClipboardItem', class {
      constructor(public data: Record<string, Blob>) {}
    })

    await expect(copyTaskTableToClipboard(options)).resolves.toBe('rich')
    expect(write).toHaveBeenCalledTimes(1)
    const payload = write.mock.calls[0][0][0] as any
    expect(Object.keys(payload.data)).toEqual(['text/html', 'text/plain'])
  })

  it('① 抛错（非安全上下文）时继续往下走，不直接把异常抛给调用方', async () => {
    const write = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true })
    vi.stubGlobal('ClipboardItem', class {
      constructor(public data: Record<string, Blob>) {}
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    // 后面三条路径在 jsdom 里都不可用 → 最终 failed，但函数必须正常 resolve
    await expect(copyTaskTableToClipboard(options)).resolves.toBe('failed')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('② 只有 execCommand 时走 copy 事件桥，仍算 rich', async () => {
    const execCommand = vi.fn().mockImplementation(() => {
      const event = new Event('copy') as ClipboardEvent
      const store: Record<string, string> = {}
      Object.defineProperty(event, 'clipboardData', {
        value: { setData: (type: string, value: string) => { store[type] = value } },
      })
      document.dispatchEvent(event)
      expect(store['text/html']).toContain('<table')
      expect(store['text/plain']).toBe('确认图')
      return true
    })
    ;(document as any).execCommand = execCommand

    await expect(copyTaskTableToClipboard(options)).resolves.toBe('rich')
    expect(execCommand).toHaveBeenCalled()
    delete (document as any).execCommand
  })

  it('④ 只有纯文本通道时返回 plain（内容不丢）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await expect(copyTaskTableToClipboard(options)).resolves.toBe('plain')
    expect(writeText).toHaveBeenCalledWith('确认图')
  })

  it('所有路径都不可用时返回 failed，而不是抛异常', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(copyTaskTableToClipboard(options)).resolves.toBe('failed')
  })
})
