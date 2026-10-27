import{describe,expect,it}from'vitest';import{createNewProject}from'../src/model/newProject';import{validateProject}from'../src/model/validate';import{simulate}from'../src/engine';import{openProjectJSON,serializeProject}from'../src/storage/projectFile';
describe('new editable process',()=>{
 it.each(['factory','festival','service']as const)('creates a valid portable %s process and unique sampling/document identities',world=>{
  const a=createNewProject(world),b=createNewProject(world);expect(a.id).not.toBe(b.id);expect(a.model.id).not.toBe(b.model.id);expect(a.model.nodes.every(n=>!b.model.nodes.some(other=>other.samplingId===n.samplingId))).toBe(true);expect(validateProject(a)).toEqual([]);expect(openProjectJSON(serializeProject(a))).toEqual(a);const run=simulate(a.model);expect(run.status).toBe('completed');expect(run.summary).toMatchObject({arrivals:60,completed:60,inSystem:0,meanWait:0});
 });
});
