# Usage Guide: Planning with Files

This skill implements the **Manus Context Engineering** methodology, using the filesystem as persistent working memory to manage complex tasks effectively.

## 1. Core Concept: Files as Memory
In modern AI development, the "Context Window" is like volatile RAM—it can get full or reset. The **filesystem** is like a persistent hard drive.
- **Volatile Context**: Hallucinations, forgetting goals, "lost in the middle."
- **Persistent Memory**: Always knows the plan, remembers research, logs errors.

## 2. The Planning Toolkit (3-File Pattern)
When this skill is active, I will maintain three specific files in your project root:

| File | Purpose | When I Update It |
|------|---------|------------------|
| `task_plan.md` | Tracks phases, goals, and high-level decisions. | Each time a phase starts/completes. |
| `findings.md` | Stores research data, URLs, and discovered context. | After every 2 search or view operations. |
| `progress.md` | A live log of tool calls, test results, and sessions. | Throughout the working session. |

## 3. Integrated Hooks (Gemini CLI)
Because I've configured the hooks in your `settings.json`, the following behaviors are now automated:

- **Session Continuity**: When you start a new chat, I automatically read `task_plan.md` to pick up exactly where we left off.
- **Attention Management**: Before I run any tool, the hooks inject the first 30 lines of your `task_plan.md` into my prompt. This keeps your goals in my "immediate attention" span.
- **Phase Awareness**: I am constantly reminded of my current phase so I don't wander off-task.

## 4. How to Use It

### Step 1: Trigger Complexity
You don't need to do anything special. Just describe a complex or multi-step task.
> *"Let's refactor the entire state management in dialerjavascript.js and ensure it works with the new dashboard."*

### Step 2: The Activation Prompt
Gemini will detect the multi-step nature and ask to activate:
`Gemini wants to activate skill: planning-with-files. Allow? [y/n]`
Type **'y'** to start the Manus workflow.

### Step 3: Collaborative Planning
I will generate the files and ask for your feedback on the `task_plan.md`. Once you approve, I'll execute the steps systematically.

## 5. Manual Commands
You can also control the skill manually in the Gemini terminal:
- `/skills enable planning-with-files` : Force activation.
- `/skills list` : See all installed skills.
- `/skills reload` : Refresh skill definitions.

---

## The Manus Rules of Engagement
To ensure high-quality results, I follow these rules when the skill is active:
1. **The 2-Action Rule**: After every 2 research/view calls, I MUST save findings to disk before they are "pushed out" of my context window.
2. **The 3-Strike Rule**: If an action fails once, I diagnose. If it fails twice, I try a completely different approach. I never repeat a failing action 3 times.
3. **Read Before Decision**: I will re-read the plan before making major architectural decisions to ensure alignment with your goals.
