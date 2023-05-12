import { createAddress } from 'forta-agent-tools';

export const autoAddress = (
  (i) => () =>
    createAddress('0xa' + i++)
)(0);
