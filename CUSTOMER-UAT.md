# TimeMaxx

TimeMaxx is a daily planning app that helps you compare what you intended to do with what you actually did.

No account is required. Your timeline data stays on your device.

## Who this is for
- People who time-block their day.
- Anyone who wants a quick way to see if they stayed on plan.
- Users who want daily and monthly progress at a glance.

## What you can do
- Add time blocks as either `Plan` or `Done`.
- View your day in three ways: `Compare`, `Plan`, or `Done`.
- Drag blocks to adjust timing.
- Assign each block to one category (Work, Health, Break, etc.).
- Link a done block back to a planned block.
- Mark a plan block complete from the timeline with a checkbox that copies and links it into done.
- Check daily insights:
  - Execution Score
  - Planned vs Done totals
  - Planned vs Done by category
- Open a month calendar and see daily completion percentages.
- Share a day summary as text.
- Import a shared summary into a day.
- Copy plan blocks from one day to another.
- Create, rename, recolor, show/hide, and delete categories.
- Reset all app data when needed.

## Common use cases
1. Morning planning: Add plan blocks for your day by hour.
2. End-of-day review: Log done blocks and compare against your plan.
3. Weekly reflection: Use month view to spot strong and weak days.
4. Team or coach check-in: Share a summary without giving app access.
5. Repeatable days: Copy yesterday's plan into today, then adjust.

## Customer UAT (non-technical)

Use this as an acceptance checklist from a user standpoint.

### 1. First-time experience
1. Open the app.
2. Confirm the main screen shows a day timeline.
3. Add a first block from the timeline.

Expected result:
- You can create a block without setup.
- The new block appears in the timeline immediately.

### 2. Plan and done flow
1. Add at least two `Plan` blocks.
2. Add at least two `Done` blocks.
3. Switch between `Compare`, `Plan`, and `Done`.

Expected result:
- Compare view shows both lanes side by side.
- Plan view shows only planned blocks.
- Done view shows only done blocks.

### 3. Editing and schedule changes
1. Open an existing block.
2. Change title, category, and time.
3. Save.
4. Drag the block to a new time.

Expected result:
- Changes save correctly.
- Dragging updates the block timing.
- Overlapping times are blocked with a clear message.

### 4. Plan-to-done linking
1. Add a planned block.
2. Tap the planned block checkbox on timeline.
3. Open the created done block and confirm it counts toward the planned item.
4. Add at least one existing done block, then check another planned block.
5. Fill done timeline so no slot can fit another checked plan block.

Expected result:
- Done block is created from plan details and linked to the source plan block.
- If done already has blocks, the copied block is placed in the earliest available slot that fits on the same day.
- If no slot can fit the duration, show a succinct error message.
- Link relationship is visible and usable.

### 5. Insights and performance
1. Open `Insights`.
2. Review Execution Score and Planned vs Done totals.
3. Review category-level over/under bars.

Expected result:
- Metrics are easy to understand.
- Totals and category comparisons match your blocks for the day.

### 6. Day and month navigation
1. Move to previous/next day.
2. Open calendar month view.
3. Open any day from the month grid.

Expected result:
- You can move between dates quickly.
- Month view shows daily completion percentages for past/current days.
- Tapping a date opens that day timeline.

### 7. Sharing and importing
1. Share a day summary.
2. Import that summary into another day.

Expected result:
- Shared text includes plan, done, totals, and categories.
- Import creates valid blocks and skips invalid or conflicting entries.

### 8. Category management
1. Add a custom category and color.
2. Edit category name/color.
3. Hide a category from timeline visibility.

Expected result:
- Category updates apply immediately.
- Hidden categories are filtered from timeline views.
- At least one category remains visible.

### 9. Privacy and support
1. Open Legal & Support in Settings.
2. Review Privacy Policy, Terms, and Support.
3. Use support email action.

Expected result:
- Policies are readable in-app.
- Support contact action works.
- Privacy message is clear: data is stored locally and can be reset.

### 10. Data reset
1. Use `Reset all data`.
2. Return to day and month views.

Expected result:
- All blocks are removed.
- Categories return to defaults.
- App remains usable after reset.

## Success criteria
- A new user can plan a day in under 2 minutes.
- A returning user can log done blocks and review insights in under 1 minute.
- Sharing/importing summaries works for normal day planning use.
- The app remains understandable without tutorials or technical knowledge.
