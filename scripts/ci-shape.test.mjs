import { expect, test } from 'bun:test'

const workflow = await Bun.file('.github/workflows/ci.yml').text()

test('CI guards every optional mobile command for the master branch shape', () => {
  for (const step of ['Mobile lint', 'Expo Doctor', 'Mobile client tests']) {
    const escapedStep = step.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    expect(workflow).toMatch(
      new RegExp(
        `- name: ${escapedStep}\\n\\s+if: \\$\\{\\{ hashFiles\\('mobile/package\\.json'\\) != '' \\}\\}\\n\\s+run:`,
      ),
    )
  }
})

test('CI validates pushes to both template branches', () => {
  expect(workflow).toContain('      - master\n')
  expect(workflow).toContain('      - mobile\n')
})
