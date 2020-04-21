import React, { useState, useMemo } from 'react';
import { useSelector } from 'react-redux'
import { useHistory, useParams } from "react-router"
import { createSelector } from 'reselect'
import {
    Card,
    CardHeader,
    CardBody,
    PageSection,
    Toolbar,
    ToolbarGroup,
    ToolbarItem,
} from '@patternfly/react-core';
import {
    Area,
    Label,
    Legend,
    ComposedChart,
    Line,
    CartesianGrid,
    XAxis,
    YAxis,
    Tooltip,
    ReferenceArea,
} from 'recharts';
import { AutoSizer } from 'react-virtualized';
import { DateTime } from 'luxon';
import { buildName } from '../redux/selectors';
import OverloadTooltip from '../components/OverloadTooltip'
import theme from '../theme';

import {
    getData, 
    getDomain,
    getStats,
    getForkMetricMap, 
    getAllTotals, 
    getAllFailures, 
    getAllPhaseNames,
    getAllForkNames,
    getAllMetricNames,
} from '../redux/selectors';


const stats = ['99.99', '99.9', '99.0', '90.0', '50.0', 'Mean'];

const colors = theme.colors.chart
const colorNames = Object.keys(colors);

const phasesTimetable = (data = [], stats = [], getStart = v => v.startTime, getEnd = v => v.endTime, getKey = v=>v._pif) => {
    let rtrn = {}
    data.forEach(entry => {
        const start = getStart(entry);
        const end = getEnd(entry);

        const rtrnStart = rtrn[start] || { _areaKey: start }
        const rtrnEnd = rtrn[end] || { _areaKey: end }

        const key = getKey(entry);//phaseName

        stats.forEach((statName, statIndex) => {
            let statKey, statValue
            if (typeof statName === "string") {
                statKey = key + "_" + statName;
                statValue = entry[statName];
            } else {
                statKey = key + "_" + statName.name;
                statValue = statName.accessor(entry)
            }
            rtrnStart[statKey] = statValue
            rtrnEnd[statKey] = statValue
        })
        rtrnStart.start = start
        rtrnStart.end = end
        rtrnEnd.start = start
        rtrnEnd.end = end

        rtrn[start] = rtrnStart;
        rtrn[end] = rtrnEnd;
    })
    //sort by the timestamp
    rtrn = Object.values(rtrn).sort((a, b) => a._areaKey - b._areaKey)
    return rtrn
}
const getPhaseTransitionTs = (data = [], getStart = (v) => v.startTime, getEnd = v => v.endTime) => {
    const rtrn = []
    data.forEach(entry=>{
        rtrn.push(getStart(entry.series[0]))
        rtrn.push(getStart(entry.series[entry.series.length - 1]))
        rtrn.push(getEnd(entry.series[0]))
        rtrn.push(getEnd(entry.series[entry.series.length - 1]))        
    })
    return [...new Set(rtrn)]
}

const useZoom = () => {
    const [left, setLeft] = useState(false)
    const [right, setRight] = useState(false)
    return {
        left,
        right,
        setLeft,
        setRight,
    };
}

const nanoToMs = (v) => Number(v / 1000000.0).toFixed(0) + "ms"
const tsToHHmmss = (v) => DateTime.fromMillis(v).toFormat("HH:mm:ss")

const domainSelector = createSelector(
    getStats(),
    getDomain
);

export default () => {

    const stats = useSelector(getStats());
    const forkNames = useSelector(getAllForkNames);
    const metricNames = useSelector(getAllMetricNames);

    const fullDomain = useSelector(domainSelector);
    const [currentDomain, setDomain] = useState(fullDomain);

    const zoom = useZoom();

    const statAccessors = [
        { name: "99.99", accessor: v => v.percentileResponseTime['99.99'] },
        { name: "99.9", accessor: v => v.percentileResponseTime['99.9'] },
        { name: "99.0", accessor: v => v.percentileResponseTime['99.0'] },
        { name: "90.0", accessor: v => v.percentileResponseTime['90.0'] },
        { name: "50.0", accessor: v => v.percentileResponseTime['50.0'] },
        { name: "Mean", accessor: v => v.meanResponseTime },
        { name: "rps", accessor: v => v.requestCount / ((v.endTime - v.startTime) / 1000) },
    ];

    const sections = useMemo(()=>{
        if(currentDomain[0] !== fullDomain[0] || currentDomain[1] !== fullDomain[1]){
            setDomain(fullDomain)
        }
        
        
        const rtrn = [];

        const phaseTransitionTs = getPhaseTransitionTs(stats
                // , v=>v.startTime-v.startTime%1000 
                // , v=>v.endTime-v.endTime%1000
            ).filter(v => v > currentDomain[0] && v < currentDomain[1]);

        forkNames.forEach(forkName=>{
            metricNames.forEach(metricName=>{
                const forkMetric_stats = stats.filter(v=>v.fork == forkName && v.metric == metricName)
                const phaseNames = [...new Set(forkMetric_stats.map(v=>v.phase))]
                phaseNames.sort()
                const series = forkMetric_stats.flatMap(v=>v.series.map(entry=>{
                    entry._pif = v.name
                    return entry;
                }))
                if(series.length > 0){
                    const phaseIds = [...new Set(series.map(v=>v._pif))]
                    

                    const timetable = phasesTimetable(
                        series,
                        statAccessors
                        // ,
                        // v=>v.startTime-v.startTime%1000 , 
                        // v=>v.endTime-v.endTime%1000,
                        // v=>v._pif
                    ).filter(v =>
                        (v.start <= currentDomain[1] && v.start >= currentDomain[0]) ||
                        (v.end >= currentDomain[0] && v.end <= currentDomain[1])
                    )

                    let colorIndex = -1;
                    const areas = [];
                    const rightLines = [];
                    const legendPayload = []
                    const tooltipExtra = []

                    phaseNames.forEach((phaseName,phaseIndex)=>{
                        colorIndex++;
                        if(colorIndex >= colorNames.length){
                            colorIndex = 0;
                        }
                        const pallet = colors[colorNames[colorIndex]];

                        phaseIds.filter(phaseId=>phaseId.startsWith(phaseName)).forEach(phaseId =>{
                            statAccessors
                                .map(v => typeof v === "string" ? v : v.name)
                                .filter(v=>v!=="rps")
                                .forEach((statName,statIndex)=>{
                                const color = pallet[statIndex % pallet.length]
                                areas.push(
                                    <Area
                                        key={`${phaseId}_${statName}`}
                                        name={statName}
                                        dataKey={`${phaseId}_${statName}`}
                                        stroke={color}
                                        unit="ns"
                                        fill={color}
                                        connectNulls={true} //needs to be true for cases of overlap betweeen phases
                                        type="monotone"
                                        yAxisId={0}
                                        isAnimationActive={false}
                                        style={{ opacity: 0.5 }}
                                    />
                                )
                            })
                            rightLines.push(
                                <Line
                                    key={`${phaseId}_rps`}
                                    yAxisId={1}
                                    name={"Requests/s"}
                                    dataKey={`${phaseId}_rps`}
                                    stroke={"#A30000"}
                                    fill={"#A30000"}
                                    connectNulls={true}
                                    dot={false}
                                    isAnimationActive={false}
                                    style={{ strokeWidth: 1 }}
                                />
                            )
                        })
                        legendPayload.push({
                            color: pallet[0],
                            fill: pallet[0],
                            type: 'rect',
                            value: phaseName                            
                        })
                    })
                    legendPayload.push({
                        color: '#A30000',
                        fill: '#A30000',
                        type: 'rect',
                        value: 'Requests/s'                        
                    })
                    rtrn.push(
                        <PageSection key={`${forkName}.${metricName}`}>
                            <Card style={{ pageBreakInside: 'avoid'}}>
                                <CardHeader>
                                    <Toolbar className="">
                                        <ToolbarGroup>
                                            <ToolbarItem>
                                                {`${forkName} ${metricName} response times`}
                                            </ToolbarItem>
                                        </ToolbarGroup>
                                    </Toolbar>
                                </CardHeader>
                                <CardBody style={{ minHeight: 400 }} onDoubleClick={ e => {
                                    setDomain(fullDomain)
                                }}>
                                    <AutoSizer>{({height, width}) =>{
                                        return (
                                            <ComposedChart
                                                width={width}
                                                height={height}
                                                data={timetable}
                                                onMouseDown={e => {
                                                    if (e) {
                                                        zoom.setLeft(e.activeLabel);
                                                        zoom.setRight(e.activeLabel)

                                                        if (e.stopPropagation) e.stopPropagation();
                                                        if (e.preventDefault) e.preventDefault();
                                                        e.cancelBubble = true;
                                                        e.returnValue = false;
                                                        return false;
                                                    }
                                                    return false;
                                                }}
                                                onMouseMove={e => {
                                                    if (zoom.left) {
                                                        const r = e.activeLabel ?
                                                            e.activeLabel :
                                                            zoom.right > zoom.left ?
                                                                currentDomain[1] :
                                                                currentDomain[0]
                                                        zoom.setRight(r)
                                                    }
                                                    return false;
                                                }}
                                                onMouseUp={e => {
                                                    if (zoom.left && zoom.right && zoom.left !== zoom.right) {
                                                        let newDomain = [zoom.left, zoom.right];
                                                        if (zoom.left > zoom.right) {
                                                            newDomain = [zoom.right, zoom.left];
                                                        }
                                                        setDomain(newDomain);
                                                    }
                                                    zoom.setLeft(false);
                                                    zoom.setRight(false)
                                                }}

                                                style={{ userSelect: 'none' }}
                                            >
                                                <CartesianGrid strokeDasharray="3 3" />
                                                <XAxis
                                                    allowDataOverflow={true}
                                                    type="number"
                                                    scale="time"
                                                    dataKey="_areaKey"
                                                    ticks={phaseTransitionTs}
                                                    tickFormatter={tsToHHmmss}
                                                    //domain={domain}
                                                    domain={currentDomain}
                                                />
                                                <YAxis yAxisId={0} orientation="left" tickFormatter={nanoToMs} domain={['auto', 'auto']}>
                                                    <Label value="response time" position="insideLeft" angle={-90} offset={0} textAnchor='middle' style={{ textAnchor: 'middle' }} />
                                                    {/* <Label value="response time" position="top" angle={0} offset={0} textAnchor='start' style={{ textAnchor: 'start' }} /> */}
                                                </YAxis>
                                                <YAxis yAxisId={1} orientation="right" style={{ fill: '#A30000' }}>
                                                    <Label value={"Requests/s"} position="insideRight" angle={-90} style={{ fill: '#A30000' }} />
                                                    {/* <Label value="requests" position="top" angle={0} textAnchor='end' style={{ textAnchor: 'end' }} /> */}
                                                </YAxis>
                                                <Tooltip
                                                    content={
                                                        <OverloadTooltip
                                                            active={true}
                                                            extra={tooltipExtra}
                                                        />
                                                    }
                                                    labelFormatter={tsToHHmmss}
                                                    formatter={(e) => Number(e).toFixed(0)}
                                                />
                                                <Legend payload={legendPayload} align="left" />
                                                
                                                {areas}
                                                {rightLines}
                                                {zoom.left && zoom.right ?
                                                    (<ReferenceArea yAxisId={0} x1={zoom.left} x2={zoom.right} strokeOpacity={0.3} />)
                                                    : undefined
                                                }
                                            </ComposedChart>
                                        )
                                    }}</AutoSizer>
                                </CardBody>
                            </Card>
                        </PageSection>
                    )
                }

                
                
            })
        })
        return rtrn;
    },[stats,forkNames,metricNames,statAccessors,currentDomain,setDomain])

    return (
        <React.Fragment>{sections}</React.Fragment>
    )
}