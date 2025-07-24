# Implement tasks in temp propgress plans

The current tasks are layed out in @temp_progress_plans.

@temp_progress_plans/index.md contains a high level description of the other other files and immediate tasks. You should start here when looking for the next tasks to begin to implement. When you discover new and important tasks, you can add them here. To add new tasks, execture a sub-agent with the /temp-progress-plans command.

@temp_progress_plans/recommendations contains future TODOs that aren't immediately important, but might be relevant to our current plans, and will be implemented evetually.

@temp_progress_plans/completed_tasks contains the tasks that were already completed. When you complete a task, update the specific md file with a description of the work completed, and move the file to completed_tasks. Update temp_progress_plans/completed_tasks/index.md to describe the newly completed task. Remove the completed tasks from @temp_progress_plans/index.md.

Whenever you make progress on a task (such as completing a listed task step or component), update the temp progress plans. Use paralell sub-agents executed in a single message to update the two index files and detailed plans files at the same time. 

Whenever you begin to assess the next steps or TODOs check if the steps can be executed in paralell, or if they need to be executed sequentially. If they can be executed in paralell, use multiple sub-agents executed in a single message. 
