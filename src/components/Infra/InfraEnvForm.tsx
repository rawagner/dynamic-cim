import * as React from 'react';
import { InfraEnvForm } from 'openshift-assisted-ui-lib';
import {
  useK8sModel,
  k8sCreate,
  history,
  useK8sWatchResource,
} from '@openshift-console/dynamic-plugin-sdk/api';

import { InfraEnvKind, AgentClusterInstallKind, ClusterDeploymentKind } from '../../kind';
import { InfraEnv } from '../types';
import { getClusterDeployment } from '../../k8s';

import '../styles.scss';
import './infra.scss';
import { getAgentClusterInstall } from 'src/k8s/agentClusterInstall';

type InfraEnvWizardProps = {
  namespace: string;
};

const InfraEnvWizard: React.FC<InfraEnvWizardProps> = ({ namespace }) => {
  const [infraModel] = useK8sModel(InfraEnvKind);
  const [secretModel] = useK8sModel('core~v1~Secret');
  const [clusterDepModel] = useK8sModel(ClusterDeploymentKind);
  const [agentClusterInstallModel] = useK8sModel(AgentClusterInstallKind);
  const [infraEnvs] = useK8sWatchResource<InfraEnv[]>({
    kind: InfraEnvKind,
    namespace,
    isList: true,
  });
  const usedNames = infraEnvs.map((env) => env.metadata.name);
  const onSubmit = React.useCallback(
    async (values) => {
      const secret = await k8sCreate(secretModel, {
        kind: 'Secret',
        apiVersion: 'v1',
        metadata: {
          name: values.name,
          namespace,
        },
        data: {
          '.dockerconfigjson': btoa(values.pullSecret),
        },
        type: 'kubernetes.io/dockerconfigjson',
      });

      const labels = values.labels.reduce((acc, curr) => {
        const label = curr.split('=');
        acc[label[0]] = label[1];
        return acc;
      }, {});

      const clusterDeployment = await k8sCreate(
        clusterDepModel,
        getClusterDeployment({
          namespace,
          pullSecretName: secret?.metadata?.name,
          labels,
          name: values.name,
          baseDnsDomain: values.baseDomain,
        }),
      );
      await k8sCreate(
        agentClusterInstallModel,
        getAgentClusterInstall({
          name: values.name,
          clusterDeploymentRefName: clusterDeployment.metadata.name,
          namespace,
          ocpVersion: 'openshift-v4.7.0',
          controlPlaneAgents: 3,
          sshPublicKey: values.sshPublicKey,
          clusterNetworkCidr: '10.128.0.0/14',
          clusterNetworkHostPrefix: 23,
          serviceNetwork: '172.30.0.0/16',
        }),
      );

      const infraEnv: InfraEnv = {
        apiVersion: 'agent-install.openshift.io/v1beta1',
        kind: 'InfraEnv',
        metadata: {
          name: values.name,
          namespace,
          labels: {
            'assisted-install-location': values.location,
          },
        },
        spec: {
          agentLabelSelector: {
            matchLabels: labels,
          },
          agentLabels: labels,
          clusterRef: {
            name: values.name,
            namespace,
          },
          pullSecretRef: {
            name: values.name,
          },
          sshAuthorizedKey: values.sshPublicKey,
        },
      };

      if (values.enableProxy) {
        infraEnv.spec.proxy = {
          httpProxy: values.httpProxy,
          httpsProxy: values.httpsProxy,
          noProxy: values.noProxy,
        };
      }

      return k8sCreate(infraModel, infraEnv);
    },
    [infraModel],
  );
  return (
    <div className="infra-env__form">
      <InfraEnvForm
        usedNames={usedNames}
        onSubmit={onSubmit}
        onFinish={(values) => history.push(`/k8s/ns/${namespace}/${InfraEnvKind}/${values.name}`)}
        onClose={() => history.push(`/k8s/ns/${namespace}/${InfraEnvKind}/`)}
      />
    </div>
  );
};

export default InfraEnvWizard;
