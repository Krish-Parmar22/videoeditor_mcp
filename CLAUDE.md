this entire project is a hackathon project. DOCUMENT ALL WORK DONE IN `process.md`

we are going to make an mcp that allows us to use our agent to make edits in our mcp.

we will make an mcp that can have access to davinci resolve

we will make another mcp (Cumulus Labs VLM MCP) that will be able to reach out to a VLM model and ask it questions

for example if the user asks "cut out the person jumping", the agent needs to figure out that I need to find the start_time, and stop_time of the time the person it jumping. It should reason that it should use the Cumulus Labs VLM endpoint to find that segment. Then it can use the mcp for davinci resolve to cut_clip(t0, t1) out of the clip, then it will reflect in da vinci.

we MUST use `mcp-use` library

we can use the skill /mcp-apps-builder
to build the mcp
