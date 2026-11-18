#!/usr/bin/env bash
# The shared pieces customers' servers use, in their own resource group: network, firewall rules and the image store. Safe to run again.
# No SSH is open to these servers. The firewall allows only what phones and browsers need.
set -euo pipefail
SUB=65c0ccca-69f7-43eb-9246-3bd6a6a06b24; RG=rg-spartanreferee-servers; LOC=italynorth
az group create -n $RG -l $LOC --subscription $SUB --tags project=spartanreferee -o none
az network nsg create -g $RG -n sr-nsg -l $LOC --subscription $SUB -o none --only-show-errors
rule() { az network nsg rule create -g $RG --nsg-name sr-nsg --subscription $SUB -n "$1" --priority "$2" --access Allow --protocol "$3" --direction Inbound --source-address-prefixes Internet --destination-port-ranges $4 -o none --only-show-errors; }
rule web 1010 Tcp "80 443"
rule phones-rtmp 1020 Tcp 1935
rule phones-srt 1030 Udp 8890
rule pictures-udp 1040 Udp 8189
rule pictures-tcp 1050 Tcp 8189
az network vnet create -g $RG -n sr-vnet -l $LOC --subscription $SUB --address-prefixes 10.21.0.0/16 --subnet-name servers --subnet-prefixes 10.21.0.0/24 -o none --only-show-errors
az provider register -n Microsoft.Compute --subscription $SUB -o none
az sig create -g $RG --gallery-name spartanreferee_gallery -l $LOC --subscription $SUB -o none --only-show-errors
az sig image-definition show -g $RG --gallery-name spartanreferee_gallery --gallery-image-definition receiver --subscription $SUB -o none --only-show-errors 2>/dev/null || \
az sig image-definition create -g $RG --gallery-name spartanreferee_gallery --gallery-image-definition receiver --subscription $SUB -l $LOC --publisher HeadJudge --offer Receiver --sku ubuntu2204 --os-type Linux --os-state Generalized --hyper-v-generation V2 --features SecurityType=TrustedLaunch -o none --only-show-errors
az resource list -g $RG --subscription $SUB --query "[].{n:name,t:type}" -o table
