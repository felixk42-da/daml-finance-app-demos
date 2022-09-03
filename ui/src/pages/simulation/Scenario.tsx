// Copyright (c) 2022 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useRef, useState } from "react";
import { FormControl, Button, Grid, Paper, Typography, InputLabel, Select, MenuItem, MenuProps, Table, TableBody, TableRow, TableCell, TextField, Accordion, AccordionSummary, AccordionDetails, CircularProgress } from "@mui/material";
import { useLedger, useParty, useStreamQueries } from "@daml/react";
import useStyles from "../styles";
import { Spinner } from "../../components/Spinner/Spinner";
import { Instrument as Derivative } from "@daml.js/daml-finance-instrument-generic/lib/Daml/Finance/Instrument/Generic/Instrument";
import { Service } from "@daml.js/daml-finance-app/lib/Daml/Finance/App/Lifecycle/Service";
import classnames from "classnames";
import { ClaimsTreeBuilder, ClaimTreeNode } from "../../components/Claims/ClaimsTreeBuilder";
import { claimToNode, findObservables } from "../../components/Claims/util";
import { render } from "../../components/Claims/renderScenario";
import { ExpandMore } from "@mui/icons-material";
import { dedup } from "../../util";
import { emptyMap } from "@daml/types";
import { Observation } from "@daml.js/daml-finance-refdata/lib/Daml/Finance/RefData/Observation";

type Payout = {
  asset : string
  amount : number
}

type Result = {
  fixing : number
  payouts : Payout[]
}

export const Scenario : React.FC = () => {
  const classes = useStyles();
  const el = useRef<HTMLDivElement>(null);

  const [ assetLabel, setAssetLabel ] = useState("");
  const [ expiry, setExpiry ] = useState<string>("");
  const [ fixings, setFixings ] = useState<string[]>([]);
  const [ underlyings, setUnderlyings ] = useState<string[]>([]);
  const [ observables, setObservables ] = useState<string[]>([]);
  const [ min, setMin ] = useState<number>(0);
  const [ step, setStep ] = useState<number>(0);
  const [ max, setMax ] = useState<number>(0);
  const [ simulating, setSimulating ] = useState(false);
  const [ results, setResults ] = useState<Result[]>([]);
  // const [ math, setMath ] = useState<string>("");
  const [ node, setNode ] = useState<ClaimTreeNode | undefined>();

  const party = useParty();
  const ledger = useLedger();

  const { contracts: derivatives, loading: l1 } = useStreamQueries(Derivative);
  const { contracts: services, loading: l2 } = useStreamQueries(Service);

  const asset = derivatives.find(c => c.payload.id.unpack === assetLabel);

  useEffect(() => {
    if (!!asset) setNode(claimToNode(asset.payload.claims));
  }, [asset]);

  useEffect(() => {
    const getStaticData = async () => {
      if (!!asset) {
        const [exp, ] = await ledger.exercise(Service.Expiry, services[0].contractId, { claims: asset.payload.claims });
        const [und, ] = await ledger.exercise(Service.Underlying, services[0].contractId, { claims: asset.payload.claims });
        const [pay, ] = await ledger.exercise(Service.Payoffs, services[0].contractId, { claims: asset.payload.claims });
        const [fix, ] = await ledger.exercise(Service.Fixings, services[0].contractId, { claims: asset.payload.claims });
        const undLabels = und.map(c => c.id.unpack);
        const obsLabels = pay.flatMap(p => findObservables(p._1));
        setExpiry(exp || "");
        setUnderlyings(dedup(undLabels));
        setObservables(dedup(obsLabels));
        setFixings(dedup(fix));
      }
    };
    getStaticData();
  }, [services, asset, ledger, party]);

  useEffect(() => {
    if (!el.current) return;
    el.current.innerHTML = "";
    const data : any = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const filtered = r.payouts.filter(p => p.asset === underlyings[0]);
      let payout = 0;
      for (let j = 0; j < filtered.length; j++) payout += filtered[j].amount;
      // TODO: observables[0] and underlyings[0] are not reliable in case of multiple entries
      data.push({ price: r.fixing, priceAsset: observables[0], value: payout, valueAsset: underlyings[0] });
    }
    render(el.current, data, 400);
  }, [el, results, observables, underlyings]);

  // useEffect(() => {
  //   const getFormula = async () => {
  //     if (services.length === 0 || underlyings.length === 0 || !asset) return;
  //     const claims = mapToText(asset.payload.claims);
  //     const [ { _2: formulaText }, ] = await ledger.exercise(Service.PreviewPricing, services[0].contractId, { ccy: "USD", claims })
  //     console.log(formulaText);
  //     setMath(formulaText);
  //   }
  //   getFormula();
  // }, [ledger, services, underlyings, asset]);

  if (l1 || l2) return (<Spinner />);
  if (services.length === 0) return (<div style={{display: 'flex', justifyContent: 'center', marginTop: 350 }}><h1>No lifecycle service found</h1></div>);

  const simulate = async () => {
    if (!asset) return;
    setSimulating(true);
    const res : Result[] = [];
    for (let fixing = min; fixing <= max; fixing += step) {
      const prices = emptyMap<string, string>().set(expiry, fixing.toString());
      const observable = await ledger.create(Observation, { provider: party, obsKey: observables[0], observations: prices, observers: emptyMap<any, any>() })
      const [ { _2: result }, ] = await ledger.exercise(Service.PreviewLifecycle, services[0].contractId, { today: expiry, observableCids: [observable.contractId], claims: asset.payload.claims });
      await ledger.archive(Observation, observable.contractId);
      res.push({ fixing, payouts: result.map(r => ({ amount: parseFloat(r.amount), asset: r.asset.id.unpack })) });
    }
    setSimulating(false);
    setResults(res);
  }

  const menuProps : Partial<MenuProps> = { anchorOrigin: { vertical: "bottom", horizontal: "left" }, transformOrigin: { vertical: "top", horizontal: "left" } };
  return (
    <Grid container direction="column" spacing={2}>
      <Grid item xs={12}>
        <Typography variant="h4" className={classes.heading}>Scenario Simlulation</Typography>
      </Grid>
      <Grid item xs={12}>
        <Grid container direction="row" spacing={2}>
          <Grid item xs={4} />
          <Grid item xs={4}>
            <FormControl className={classes.inputField} fullWidth>
              <InputLabel className={classes.selectLabel}>Asset</InputLabel>
              <Select variant="standard" className={classes.width90} value={assetLabel} onChange={e => setAssetLabel(e.target.value as string)} MenuProps={menuProps}>
                {derivatives.map((c, i) => (<MenuItem key={i} value={c.payload.id.unpack}>{c.payload.id.unpack}</MenuItem>))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={4} />
        </Grid>
      </Grid>
      <Grid item xs={12}>
        <Grid container direction="row" spacing={2}>
          <Grid item xs={6}>
            <Paper className={classnames(classes.fullWidth, classes.paper)}>
              <Typography variant="h5" className={classes.heading}>Asset</Typography>
              <ClaimsTreeBuilder node={node} setNode={setNode} assets={[]}/>
            </Paper>
          </Grid>
          <Grid item xs={6}>
            <Grid container direction="column" spacing={2}>
              <Grid item xs={12}>
                <Accordion defaultExpanded>
                  <AccordionSummary expandIcon={<ExpandMore />} id="panel1a-header">
                    <Typography variant="h5" className={classes.heading}>Static Data</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Table size="small">
                      <TableBody>
                        <TableRow key={0} className={classes.tableRow}>
                          <TableCell key={0} className={classes.tableCell}><b>Expiry Date</b></TableCell>
                          <TableCell key={1} className={classes.tableCell}>{expiry.substring(0, 10)}</TableCell>
                        </TableRow>
                        <TableRow key={1} className={classes.tableRow}>
                          <TableCell key={0} className={classes.tableCell}><b>Fixing Dates</b></TableCell>
                          <TableCell key={1} className={classes.tableCell}>{fixings[0]?.substring(0, 10)}</TableCell>
                        </TableRow>
                        {fixings.slice(1).map((f, i) => (
                          <TableRow key={f} className={classes.tableRow}>
                            <TableCell key={0} className={classes.tableCell}></TableCell>
                            <TableCell key={1} className={classes.tableCell}>{f.substring(0, 10)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow key={2} className={classes.tableRow}>
                          <TableCell key={0} className={classes.tableCell}><b>Underlyings</b></TableCell>
                          <TableCell key={1} className={classes.tableCell}>{underlyings[0]}</TableCell>
                        </TableRow>
                        {underlyings.slice(1).map((u, i) => (
                          <TableRow key={u} className={classes.tableRow}>
                            <TableCell key={0} className={classes.tableCell}></TableCell>
                            <TableCell key={1} className={classes.tableCell}>{u}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow key={3} className={classes.tableRow}>
                          <TableCell key={0} className={classes.tableCell}><b>Observables</b></TableCell>
                          <TableCell key={1} className={classes.tableCell}>{observables[0]}</TableCell>
                        </TableRow>
                        {observables.slice(1).map((o, i) => (
                          <TableRow key={o + i} className={classes.tableRow}>
                            <TableCell key={0} className={classes.tableCell}></TableCell>
                            <TableCell key={1} className={classes.tableCell}>{o}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AccordionDetails>
                </Accordion>
                <Accordion defaultExpanded>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography variant="h5" className={classes.heading}>Simulation</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    {observables.map((o, i) => (
                      <>
                        <TextField className={classes.inputField} style={{ marginRight: 10 }} label="Observable"  type="text" value={o} InputProps={{ readOnly: true }} />
                        <TextField className={classes.inputField} style={{ marginRight: 10 }} label="Min"  type="number" value={min}  onChange={e => setMin(parseInt(e.target.value))} />
                        <TextField className={classes.inputField} style={{ marginRight: 10 }} label="Step" type="number" value={step} onChange={e => setStep(parseInt(e.target.value))} />
                        <TextField className={classes.inputField} style={{ marginRight: 10 }} label="Max"  type="number" value={max}  onChange={e => setMax(parseInt(e.target.value))} />
                      </>
                    ))}
                    <Button className={classnames(classes.fullWidth, classes.buttonMargin)} size="large" variant="contained" color="primary" disabled={!min || !step || !max || simulating} onClick={simulate}>{simulating ? (<CircularProgress size={26} />) : "Simulate"}</Button>
                  </AccordionDetails>
                </Accordion>
                {results.length > 0 && <Accordion defaultExpanded>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography variant="h5" className={classes.heading}>Results</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <div ref={el} style={{ height: "100%" }}/>
                  </AccordionDetails>
                </Accordion>}
              </Grid>
            </Grid>
          </Grid>
        </Grid>
      </Grid>
      {/* <Grid item xs={12}>
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography variant="h5" className={classes.heading}>Pricing Formula <i>(Experimental)</i></Typography>
          </AccordionSummary>
          <AccordionDetails>
            <MathComponent mathml={math} />
          </AccordionDetails>
        </Accordion>
      </Grid> */}
    </Grid>
  );
};
