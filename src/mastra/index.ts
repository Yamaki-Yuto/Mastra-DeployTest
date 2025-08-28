
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
//import { LibSQLStore } from '@mastra/libsql';
import { weatherWorkflow } from './workflows/weather-workflow';
import { weatherAgent } from './agents/weather-agent';
import { mimicAgent } from './agents/mimic-agent';
import { pmAgent } from './agents/pm-agent';
import { imageCreatorAgent } from './agents/imageCreator';
// 既存のagents/workflowsのimportはそのまま


export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents: { weatherAgent, mimicAgent, pmAgent, imageCreatorAgent },
  /*storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: "file:../mastra.db",
  }),*/
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
