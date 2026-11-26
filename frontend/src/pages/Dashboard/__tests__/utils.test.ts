import { describe, expect, it } from 'vitest'
import { buildBatchAddHistoryItems } from '../utils'
import type { TaskItem } from '../types'

/**
 * 粘贴 / 复制到其他格子后，撤销栈里那条 batchAdd 记录完全由这个函数生成。
 * 下标错位会让「撤销」恢复成另一个任务的内容，所以这里把对应关系钉死。
 */
const task = (id: string, name: string): TaskItem => ({ id, taskName: name, hours: 1 })

describe('buildBatchAddHistoryItems', () => {
  it('按提交顺序把新 id 与原始内容配对', () => {
    const clipboard = [task('a', '确认图 A'), task('b', '设计 B')]
    const result = buildBatchAddHistoryItems([{ id: 'new-1' }, { id: 'new-2' }], clipboard, 'd1', '2026-11-26')

    expect(result).toEqual([
      { designerId: 'd1', date: '2026-11-26', itemId: 'new-1', item: clipboard[0] },
      { designerId: 'd1', date: '2026-11-26', itemId: 'new-2', item: clipboard[1] },
    ])
  })

  it('接口没返回 items 时给空数组，调用方不必再判空', () => {
    expect(buildBatchAddHistoryItems(undefined, [task('a', 'x')], 'd1', '2026-11-26')).toEqual([])
    expect(buildBatchAddHistoryItems(null, [task('a', 'x')], 'd1', '2026-11-26')).toEqual([])
  })

  it('剪贴板为空时 item 为 undefined，但 id 仍要登记（否则撤销不知道删哪条）', () => {
    const result = buildBatchAddHistoryItems([{ id: 'new-1' }], null, 'd1', '2026-11-26')
    expect(result).toHaveLength(1)
    expect(result[0].itemId).toBe('new-1')
    expect(result[0].item).toBeUndefined()
  })

  it('新建条数少于内容条数时只取前面几条，不抛错', () => {
    const clipboard = [task('a', 'A'), task('b', 'B')]
    const result = buildBatchAddHistoryItems([{ id: 'new-1' }], clipboard, 'd1', '2026-11-26')
    expect(result).toHaveLength(1)
    expect(result[0].item).toBe(clipboard[0])
  })
})
