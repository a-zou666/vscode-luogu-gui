import vscode from 'vscode';

import myArticle from './myArticle';
import history from './history';
import training from './training';
import viewProblem from './viewProblem';
import login from './login';
import submit from './submit';
import record from './record';
import solution from './solution';
import benben from './benben';
import contest from './contest';
import workbench from './workbench';

export default function registerFeatures(context: vscode.ExtensionContext) {
  for (const registerFeature of [
    login,
    myArticle,
    history,
    training,
    viewProblem,
    submit,
    record,
    solution,
    benben,
    contest,
    workbench
  ])
    registerFeature(context);
}
