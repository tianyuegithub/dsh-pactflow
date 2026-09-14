import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Agent-plane composition: red lines in the persona, everything else in
 * skills that load on demand.
 *
 * The split has exactly one criterion — does it go wrong if the model never
 * loads it? "Never grant a human approval" does; "prefer one delivery node"
 * does not, because an unreasonable split still has to survive human plan
 * selection. That criterion is also what the dangerous failure looks like:
 * moving a red line into a skill turns a hard constraint into "applies when the
 * model remembers to load it", which is why the guard below checks both
 * directions.
 */

const presetRoot = resolve(import.meta.dirname, '..', 'presets', 'pactflow')
const composition = readFileSync(resolve(presetRoot, 'agent.cordis.yml'), 'utf8')
const personaText = composition.slice(
  composition.indexOf('text: |-'),
  composition.indexOf('complete: true'),
)
const skillsRoot = resolve(presetRoot, 'skills')
const skillNames = readdirSync(skillsRoot)
const skillBodies = new Map(skillNames.map(name =>
  [name, readFileSync(resolve(skillsRoot, name, 'SKILL.md'), 'utf8')]))

/**
 * Each red line, described by the constraint elements that must remain
 * identifiable. Not a whole-string comparison — that would go red on every
 * wording pass until someone weakened or deleted the guard — and not merely
 * "the text is non-empty" either.
 */
const RED_LINES = [
  {
    id: 'read-only-orchestrator',
    elements: [/read-only orchestrator/i, /cannot modify the shared workspace/i],
  },
  {
    id: 'never-self-approve',
    elements: [/never grant, forge or imply a human approval/i, /native approval surface/i],
  },
  {
    id: 'no-direct-workspace-write',
    elements: [/do not attempt Bash/i, /isolated task branch/i, /verified commit/i],
  },
  {
    id: 'plan-confirmation-before-dispatch',
    elements: [/[Bb]efore ANY execution-agent dispatch/, /pactflow_confirm_execution_plan/, /not consent/i],
  },
  {
    id: 'worker-boundary',
    elements: [/delegated as a Worker/i, /Do not merge or switch to the default branch/i, /never hidden as success/i],
  },
] as const

describe('PactFlow persona keeps every red line', () => {
  it.each(RED_LINES)('$id stays identifiable in the persona', redLine => {
    for (const element of redLine.elements) {
      expect(personaText, `red line "${redLine.id}" lost the element ${String(element)}`).toMatch(element)
    }
  })

  it('fails when a red line is removed', () => {
    // Proves the guard above is load-bearing rather than vacuous.
    const withoutOne = personaText.replace(/never grant, forge or imply a human approval/i, 'is helpful')
    const stillMatches = RED_LINES.every(line => line.elements.every(element => element.test(withoutOne)))
    expect(stillMatches).toBe(false)
  })

  it('does not accept an empty persona', () => {
    const elements = RED_LINES.flatMap(line => line.elements)
    expect(elements.every(element => element.test(''))).toBe(false)
    expect(personaText.length).toBeGreaterThan(200)
  })
})

describe('PactFlow red lines are never delegated to an on-demand skill', () => {
  it.each(RED_LINES)('$id is not carried only by a skill', redLine => {
    // A red line that lives in a skill is a hard constraint downgraded to
    // "applies when the model remembers to load it".
    for (const element of redLine.elements) {
      expect(personaText).toMatch(element)
    }
  })

  it('keeps self-approval and workspace-write prohibitions out of skill bodies as their only home', () => {
    const personaOnly = [/never grant, forge or imply a human approval/i, /cannot modify the shared workspace/i]
    for (const element of personaOnly) {
      expect(personaText).toMatch(element)
      for (const [name, body] of skillBodies) {
        // A skill may reference a constraint, but must not be where it first appears.
        if (element.test(body)) {
          expect(personaText, `${name} states a red line the persona must own`).toMatch(element)
        }
      }
    }
  })
})

describe('PactFlow skills are package-owned and load on demand', () => {
  it('ships six skills, each a directory bundle with a SKILL.md', () => {
    expect(skillNames.sort()).toEqual([
      'pactflow-autopilot-scope',
      'pactflow-closing-gates',
      'pactflow-execution-planning',
      'pactflow-infrastructure-resources',
      'pactflow-local-recovery',
      'pactflow-troubleshooting',
    ])
  })

  it('gives every skill frontmatter that says WHEN to load it', () => {
    for (const [name, body] of skillBodies) {
      expect(body.startsWith('---\n'), `${name} needs YAML frontmatter`).toBe(true)
      const frontmatter = body.slice(4, body.indexOf('\n---', 4))
      expect(frontmatter, `${name} must declare its own name`).toContain(`name: ${name}`)
      expect(frontmatter, `${name} needs a description`).toMatch(/description: \S/)
      // The catalog entry is how a model decides whether to load: a description
      // that only names a topic cannot answer "is this my situation".
      expect(frontmatter, `${name} description must say when to load it`).toMatch(/时加载|加载/)
    }
  })

  it('mounts the skills from the preset directory rather than a host root', () => {
    expect(composition).toContain("name: '@deepseek-ai/dsh-skill-filesystem'")
    expect(composition).toContain("name: '@deepseek-ai/dsh-tool-skill'")
    expect(composition).toContain("new URL('skills/', baseUrl)")
  })

  it('keeps full skill instructions out of the persona', () => {
    // Only the catalog hint belongs in the standing prompt; the bodies load on
    // demand, which is the whole point of the split.
    for (const [name, body] of skillBodies) {
      const firstHeading = body.slice(body.indexOf('\n# ') + 3, body.indexOf('\n', body.indexOf('\n# ') + 3))
      expect(personaText, `${name} body leaked into the persona`).not.toContain(firstHeading.trim())
    }
    expect(personaText).toContain('Load the skill that matches what you are about to do')
  })

  it('names every skill in the persona hint so none is undiscoverable', () => {
    for (const name of skillNames) expect(personaText).toContain(name)
  })
})

describe('PactFlow skill content has a single source', () => {
  const businessLogic = readFileSync(
    resolve(import.meta.dirname, '..', '..', '..', 'docs', 'business-logic-业务逻辑.md'),
    'utf8',
  )

  it.each([
    ['pactflow-closing-gates', '## 6. 质量门禁：收口三层防线', '收口三层防线'],
    ['pactflow-infrastructure-resources', '### 2.1 全局基础设施', '七类'],
    ['pactflow-troubleshooting', '## 9. 运行态与异常处置速查', '异常'],
  ])('%s owns its text instead of duplicating the business-logic doc', (skill, heading, marker) => {
    expect(skillBodies.get(skill)).toContain(marker)
    // The doc points at the skill rather than carrying a second editable copy,
    // because two copies of the same contract drift.
    const start = businessLogic.indexOf(heading)
    expect(start, `${heading} must exist in the business-logic doc`).toBeGreaterThan(-1)
    expect(businessLogic.slice(start, start + 400), `${skill} must be pointed at, not duplicated`).toContain(skill)
  })
})
